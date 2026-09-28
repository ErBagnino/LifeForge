import { getDb, metaRepository, playerRepository, questRepository, resetDbInstance, settingsRepository, tycoonRepository } from '@/repositories';
import { clock } from '../clock';
import { ensureSeeded } from '../seedService';
import { beginAdventure, ensureToday } from '../game/dayService';
import { completeQuest, loadDay, skipQuest, snoozeQuest } from '../game/questService';
import { logMeal, logMetric } from '../metricsService';
import { buildOrUpgrade } from '../tycoonService';
import { buildingCost } from '@/domain/tycoon';
import { finishSession, saveSession, startSession } from '../workoutService';
import type { Rpe } from '@/types';

/**
 * Deterministic life simulator for long-run tests: every simulated day follows a
 * behaviour profile (how much the player does), advances the clock across the real
 * 04:00 game-day boundary and returns a snapshot so invariants can be checked.
 */

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface DayProfile {
  /** Share of pending non-metric quests the player completes (0 = missed day, app not opened). */
  completion: number;
  opened?: boolean;
  workout?: boolean;
  water?: boolean;
  meals?: boolean;
  skip?: boolean;
  snooze?: boolean;
  buy?: boolean;
  doubleTap?: boolean;
}

let n = 0;
export async function freshWorld(startIso = '2026-01-05T08:30:00'): Promise<void> {
  resetDbInstance(`lifeforge-sim-${++n}-${Date.now()}`);
  clock.setOffset(new Date(startIso).getTime() - Date.now());
  await ensureSeeded();
  await metaRepository.set('adventureStart', clock.today());
  await beginAdventure();
}

/** Move the clock to HH:MM of the current or next calendar day. */
function moveTo(hm: string, nextDay = false) {
  const now = new Date(clock.now());
  const t = new Date(now);
  if (nextDay) t.setDate(t.getDate() + 1);
  const [h, m] = hm.split(':').map(Number);
  t.setHours(h, m, 0, 0);
  clock.setOffset(clock.getOffset() + (t.getTime() - now.getTime()));
}

export async function simulateDay(p: DayProfile, rand: () => number): Promise<void> {
  // Morning of the game day.
  moveTo('08:30');
  if (p.opened !== false && p.completion > 0) {
    await ensureToday();
    const date = clock.today();
    const { day } = await loadDay(date);
    const s = (await settingsRepository.get())!;
    if (p.water) await logMetric('water', Math.round(s.hydration.targetMl * (0.6 + rand() * 0.5)));
    if (p.meals) {
      await logMeal({ name: 'Breakfast oats', mealType: 'breakfast', items: [{ name: 'Oats', kcal: 420, protein: 20, carbs: 60, fat: 10 }], kcal: 420, protein: 20, carbs: 60, fat: 10, source: 'manual' });
      await logMeal({ name: 'Chicken & rice', mealType: 'lunch', items: [{ name: 'Chicken & rice', kcal: 700, protein: 55, carbs: 80, fat: 15 }], kcal: 700, protein: 55, carbs: 80, fat: 15, source: 'manual' });
    }
    await logMetric('steps', Math.round(s.steps.ideal * (0.6 + rand() * 0.7)));
    if (p.workout) {
      const w = day.find((q) => q.kind === 'workout' && q.status === 'pending');
      if (w) {
        const session = await startSession(w.workoutTemplateId, w.id);
        await saveSession({ ...session, exercises: session.exercises.map((e) => ({ ...e, sets: e.sets.map((x) => ({ ...x, reps: e.repMax, completed: true, rpe: (rand() < 0.7 ? 1 : 2) as Rpe })) })) });
        await finishSession(session.id);
      }
    }
    const pending = (await questRepository.byDate(date)).filter((q) => q.status === 'pending' && !q.metric && !q.goal && q.kind !== 'workout');
    const todo = pending.filter(() => rand() < p.completion);
    for (const q of todo) {
      await completeQuest(q.id);
      if (p.doubleTap) await completeQuest(q.id); // must never reward twice
    }
    const left = (await questRepository.byDate(date)).filter((q) => q.status === 'pending' && !q.metric && q.kind === 'scheduled' && q.tier !== 'core');
    if (p.skip && left[0]) await skipQuest(left[0].id, 'no_time');
    if (p.snooze && left[1]) await snoozeQuest(left[1].id, clock.now() + 2 * 3600_000);
    if (p.buy) {
      // Spend like a player would: the cheapest affordable upgrade.
      const buildings = (await tycoonRepository.buildings.all()).sort((a, b) => buildingCost(a, a.level + 1) - buildingCost(b, b.level + 1));
      for (const b of buildings) {
        const r = await buildOrUpgrade(b.id);
        if (r.ok) break;
      }
    }
  }
  // Late evening, then 03:59 of the next calendar day (still the same game day), then 04:00.
  moveTo('23:30');
  moveTo('03:59', true);
  moveTo('04:01');
}

export interface Snapshot {
  date: string;
  level: number;
  xp: number;
  coins: number;
  hp: number;
  streak: number;
  rooms: number;
  achievements: number;
}

export async function snapshot(): Promise<Snapshot> {
  const p = (await playerRepository.get())!;
  const rooms = (await tycoonRepository.buildings.all()).reduce((s, b) => s + b.level, 0);
  const achievements = (await getDb().achievements.toArray()).filter((a) => a.unlockedAt).length;
  return { date: clock.today(), level: p.level, xp: p.xp, coins: p.coins, hp: p.hp, streak: p.streak.current, rooms, achievements };
}

/** Invariants that must hold after any sequence of days. Returns human-readable violations. */
export async function checkInvariants(): Promise<string[]> {
  const out: string[] = [];
  const p = (await playerRepository.get())!;
  const ledger = await getDb().ledger.toArray();
  const sum = (t: string) => ledger.filter((l) => l.type === t).reduce((a, l) => a + l.amount, 0);
  if (p.xp !== Math.max(0, sum('xp'))) out.push(`xp ${p.xp} ≠ ledger ${sum('xp')}`);
  if (p.coins !== sum('coins')) out.push(`coins ${p.coins} ≠ ledger ${sum('coins')}`);
  if (p.coins < 0) out.push(`negative coins ${p.coins}`);
  if (p.hp < 0 || p.hp > 100) out.push(`hp out of range ${p.hp}`);
  if (p.energy < 0) out.push(`negative energy ${p.energy}`);
  if (p.streak.current > p.streak.longest) out.push(`streak ${p.streak.current} > longest ${p.streak.longest}`);
  const logs = await getDb().dayLogs.toArray();
  const days = new Set(logs.map((l) => l.date));
  if (days.size !== logs.length) out.push('duplicate day logs');
  if (p.streak.current > logs.filter((l) => l.success).length + p.inventory.streakFreeze + 30) out.push('impossible streak');
  for (const b of await tycoonRepository.buildings.all()) if (b.level < 0 || b.level > 5) out.push(`room ${b.id} level ${b.level}`);
  const quests = await getDb().quests.toArray();
  const rewarded = new Map<string, number>();
  for (const l of ledger) if (l.refId && l.type === 'xp' && l.amount > 0 && !l.reason.startsWith('Achievement')) rewarded.set(`${l.refId}|${l.reason}`, (rewarded.get(`${l.refId}|${l.reason}`) ?? 0) + 1);
  const doubles = [...rewarded.entries()].filter(([k, c]) => c > 1 && quests.some((q) => q.id === k.split('|')[0]));
  if (doubles.length) out.push(`double quest rewards: ${doubles.slice(0, 3).map(([k]) => k).join(', ')}`);
  for (const l of logs) {
    for (const [k, v] of Object.entries(l.metrics ?? {})) if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) out.push(`metric ${k}=${v} on ${l.date}`);
    if (!Number.isFinite(l.score) || l.score < 0 || l.score > 105) out.push(`score ${l.score} on ${l.date}`);
  }
  if (!Number.isFinite(p.xp) || !Number.isFinite(p.coins)) out.push('non-finite totals');
  return out;
}
