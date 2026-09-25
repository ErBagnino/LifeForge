import { createRng } from '@/utils/math';
import {
  achievementRepository,
  metaRepository,
  questRepository,
  settingsRepository,
  statsRepository,
  withTransaction,
  workoutRepository,
} from '@/repositories';
import type { Rpe } from '@/types';
import { clock } from './clock';
import type { GameEvent } from './events';
import { ensureToday } from './game/dayService';
import { GameTx } from './game/gameTx';
import { completeQuest, failQuest, loadDay } from './game/questService';
import { logMetric } from './metricsService';
import { notificationService } from './notifications/NotificationService';
import { finishSession, startSession } from './workoutService';

/** Developer toolbox actions (hidden unless dev mode is on). */

async function grant(fn: (tx: GameTx) => void): Promise<GameEvent[]> {
  return withTransaction(async () => {
    const tx = await GameTx.open(clock.today());
    fn(tx);
    await tx.checkAchievements();
    await tx.commit();
    return tx.events;
  });
}

export const devAddXp = (n: number) => grant((tx) => tx.addXp(n, 'Dev toolbox'));
export const devAddCoins = (n: number) => grant((tx) => tx.addCoins(n, 'Dev toolbox'));

export async function devSetClockOffset(ms: number): Promise<GameEvent[]> {
  const s = await settingsRepository.get();
  if (s) await settingsRepository.save({ ...s, clockOffsetMs: ms });
  clock.setOffset(ms);
  return (await ensureToday()).events;
}

export async function devShiftDays(days: number): Promise<GameEvent[]> {
  return devSetClockOffset(clock.getOffset() + days * 86400000);
}

/** Play today semi-realistically, then jump to tomorrow. */
export async function devSimulateDay(completion = 0.8): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  const today = clock.today();
  const rand = createRng(Date.now() % 100000);
  const s = await settingsRepository.get();
  if (s) {
    events.push(...(await logMetric('sleep', 6 + rand() * 2.5)).events);
    events.push(...(await logMetric('water', Math.round((s.hydration.targetMl * (0.7 + rand() * 0.5)) / 250) * 250, { mode: 'set' })).events);
    events.push(...(await logMetric('steps', Math.round(s.steps.ideal * (0.6 + rand() * 0.7)))).events);
    events.push(...(await logMetric('protein', Math.round(s.nutrition.protein * (0.7 + rand() * 0.4)), { mode: 'set' })).events);
    events.push(...(await logMetric('calories', Math.round(s.nutrition.calories * (0.85 + rand() * 0.3)), { mode: 'set' })).events);
    if (rand() < 0.3) events.push(...(await logMetric('weight', Math.round((s.body.weightKg + (rand() - 0.6) * 0.4) * 10) / 10)).events);
    events.push(...(await logMetric('leisure', Math.round(40 + rand() * 70), { mode: 'set' })).events);
  }
  const { day } = await loadDay(today);
  const workout = day.find((q) => q.kind === 'workout' && q.status === 'pending');
  if (workout && rand() < completion + 0.1) events.push(...(await devSimulateWorkout()));
  for (const q of day) {
    if (q.status !== 'pending' || q.metric || q.goal || q.kind === 'workout') continue;
    if (rand() < completion) events.push(...(await completeQuest(q.id)).events);
  }
  events.push(...(await devShiftDays(1)));
  return events;
}

export async function devSimulateWeek(): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  for (let i = 0; i < 7; i++) events.push(...(await devSimulateDay(0.65 + (i % 3) * 0.1)));
  return events;
}

export async function devResetDay(): Promise<GameEvent[]> {
  const today = clock.today();
  await withTransaction(async () => {
    const quests = await questRepository.byDate(today);
    for (const q of quests) if (q.kind !== 'weekly' && q.kind !== 'boss') await questRepository.remove(q.id);
    const log = await statsRepository.getLog(today);
    if (log) await statsRepository.putLog({ ...log, closed: false, achievements: [], routinesDone: [], rulesFired: [] });
    await metaRepository.remove('currentDate');
  });
  return (await ensureToday()).events;
}

export async function devUnlockAchievement(id: string): Promise<GameEvent[]> {
  const a = await achievementRepository.get(id);
  if (!a || a.unlockedAt) return [];
  return grant((tx) => {
    a.unlockedAt = tx.now;
    tx.log.achievements.push(a.id);
    tx.events.push({ type: 'achievement', achievement: a });
    tx.addXp(a.xp, `Achievement: ${a.name}`);
    tx.addCoins(a.coins, `Achievement: ${a.name}`);
  }).then(async (ev) => {
    await achievementRepository.put(a);
    return ev;
  });
}

export async function devCompleteRandomQuest(): Promise<GameEvent[]> {
  const { day } = await loadDay(clock.today());
  const q = day.find((x) => x.status === 'pending' && !x.goal);
  return q ? (await completeQuest(q.id)).events : [];
}

export async function devFailRandomQuest(): Promise<GameEvent[]> {
  const { day } = await loadDay(clock.today());
  const q = day.find((x) => x.status === 'pending');
  return q ? (await failQuest(q.id)).events : [];
}

export async function devSimulateWorkout(): Promise<GameEvent[]> {
  const { day } = await loadDay(clock.today());
  const quest = day.find((q) => q.kind === 'workout' && q.status === 'pending');
  const plan = await workoutRepository.activePlan();
  const templateId = quest?.workoutTemplateId ?? plan?.templates[0]?.id;
  const session = await startSession(templateId, quest?.id);
  const rand = createRng(session.startedAt % 9973);
  const filled = {
    ...session,
    startedAt: clock.now() - 55 * 60000,
    exercises: session.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({ ...s, reps: e.repMin + Math.floor(rand() * (e.repMax - e.repMin + 1)), completed: rand() > 0.08, rpe: (1 + Math.floor(rand() * 3)) as Rpe })),
    })),
  };
  await workoutRepository.putSession(filled);
  return (await finishSession(session.id)).events;
}

export async function devTestNotification(): Promise<string> {
  return notificationService.notify({ type: 'quest', title: '🔔 Test notification', body: 'If you can read this, notifications work.', tag: `test:${Date.now()}` });
}
