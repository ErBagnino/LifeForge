import { dailyOpening, evaluateDay, learnSchedule, type DailyContextView, type LearnedSchedule, type Opening } from '@/domain/dailyContext';
import { getDb, metaRepository, playerRepository, questRepository, settingsRepository, statsRepository, suggestionRepository, workoutRepository } from '@/repositories';
import type { DailyContext, ISODate, WorkSession } from '@/types';
import { gameDate, shiftDate } from '@/utils/date';
import { activityStreak } from '@/domain/streak';
import { clock } from './clock';
import type { ServiceResult } from './events';
import { planFor } from './game/dayPlan';

/**
 * Daily context: wake-up, work sessions and the first open of the day. Facts come
 * only from explicit taps (no GPS, no background tracking) and stay in IndexedDB.
 */

const WORK_KEY = 'workSession';
const LAST_VISIT_KEY = 'lastVisitDate';
const MAX_WORK_MIN = 16 * 60;

export interface OpenWork {
  start: number;
}

const blank = (date: ISODate): DailyContext => ({ date, work: [], updatedAt: clock.now() });

export async function getDayContext(date: ISODate = clock.today()): Promise<DailyContext> {
  return (await getDb().dayContexts.get(date)) ?? blank(date);
}

async function patchDay(date: ISODate, patch: (c: DailyContext) => DailyContext): Promise<DailyContext> {
  const next = { ...patch(await getDayContext(date)), updatedAt: clock.now() };
  await getDb().dayContexts.put(next);
  return next;
}

/**
 * Called on every app open/resume. Records the first open of the game day and returns
 * the previous visit date (for "Welcome back") exactly once per day.
 */
export async function recordOpen(): Promise<{ firstToday: boolean; lastVisit?: ISODate }> {
  const today = clock.today();
  const lastVisit = await metaRepository.get<ISODate>(LAST_VISIT_KEY);
  const ctx = await getDayContext(today);
  if (ctx.firstOpenAt) return { firstToday: false, lastVisit: lastVisit === today ? undefined : lastVisit };
  await patchDay(today, (c) => ({ ...c, firstOpenAt: clock.now() }));
  await metaRepository.set(LAST_VISIT_KEY, today);
  await metaRepository.set('previousVisitDate', lastVisit ?? null);
  return { firstToday: true, lastVisit };
}

/** The visit before today (kept after recordOpen so the opening card can use it all day). */
export async function previousVisit(): Promise<ISODate | undefined> {
  return (await metaRepository.get<ISODate | null>('previousVisitDate')) ?? undefined;
}

export async function confirmWake(ts: number, source: 'confirmed' | 'manual' | 'estimated' = 'confirmed'): Promise<DailyContext> {
  const date = gameDate(ts, clock.dayStartHour());
  return patchDay(date === clock.today() ? date : clock.today(), (c) => ({ ...c, wakeUpTime: ts, wakeSource: source }));
}

export async function wakeNotYet(): Promise<DailyContext> {
  return patchDay(clock.today(), (c) => ({ ...c, wakeAskedAt: clock.now() }));
}

export async function startDay(): Promise<DailyContext> {
  return patchDay(clock.today(), (c) => ({ ...c, dayStartedAt: c.dayStartedAt ?? clock.now() }));
}

export async function setNoWork(noWork: boolean): Promise<DailyContext> {
  return patchDay(clock.today(), (c) => ({ ...c, noWork }));
}

// ——— Work session (like the Play Time timer: survives closing the app) ———

export async function getOpenWork(): Promise<OpenWork | undefined> {
  return metaRepository.get<OpenWork>(WORK_KEY);
}

/** START WORK = leaving home (the commute is included). */
export async function startWork(): Promise<OpenWork> {
  const existing = await getOpenWork();
  if (existing) return existing;
  const w = { start: clock.now() };
  await metaRepository.set(WORK_KEY, w);
  await patchDay(clock.today(), (c) => ({ ...c, noWork: false }));
  return w;
}

export async function cancelWork(): Promise<void> {
  await metaRepository.remove(WORK_KEY);
}

/**
 * END WORK. The session belongs to the game day it started on, even across midnight,
 * so it is never split or duplicated. Forgotten timers are capped at 16 h.
 */
export async function endWork(): Promise<ServiceResult & { minutes: number; session?: WorkSession; capped: boolean }> {
  const open = await getOpenWork();
  if (!open) return { events: [], minutes: 0, capped: false };
  await metaRepository.remove(WORK_KEY);
  let end = clock.now();
  const capped = (end - open.start) / 60000 > MAX_WORK_MIN;
  if (capped) end = open.start + MAX_WORK_MIN * 60000;
  const minutes = Math.max(0, Math.round((end - open.start) / 60000));
  const session: WorkSession = { start: open.start, end, minutes, ...(capped ? { edited: true } : {}) };
  const date = gameDate(open.start, clock.dayStartHour());
  await patchDay(date, (c) => ({ ...c, work: [...c.work, session] }));
  const events: ServiceResult['events'] = capped ? [{ type: 'toast', text: 'The work timer ran over 16 h — capped. Fix the times in Settings → Daily Routine if needed.', icon: '⏱️', tone: 'warn' }] : [];
  return { events, minutes, session, capped };
}

/** Correct a past session (forgot to tap END WORK, started late…). */
export async function editWorkSession(date: ISODate, index: number, start: number, end: number): Promise<void> {
  if (end <= start) throw new Error('End must be after start.');
  const minutes = Math.min(MAX_WORK_MIN, Math.round((end - start) / 60000));
  await patchDay(date, (c) => ({ ...c, work: c.work.map((w, i) => (i === index ? { start, end, minutes, edited: true } : w)) }));
}

// ——— Learning ———

export async function learnedSchedule(): Promise<LearnedSchedule> {
  const s = await settingsRepository.get();
  const today = clock.today();
  const since = s?.routine.learnedSince;
  const empty = learnSchedule({ contexts: [], meals: [], workouts: [], dayStartHour: s?.dayStartHour ?? 4 });
  if (!s || !s.routine.adaptive) return empty;
  const from = shiftDate(today, -90);
  const [contexts, meals, workouts] = await Promise.all([
    getDb().dayContexts.where('date').between(from, today, true, true).toArray(),
    statsRepository.mealsRange(shiftDate(today, -60), today),
    questRepository.byRange(shiftDate(today, -60), today),
  ]);
  return learnSchedule({
    contexts,
    meals: meals.map((m) => ({ ts: m.ts })),
    workouts: workouts.filter((q) => q.kind === 'workout' && q.status === 'completed' && q.completedAt).map((q) => ({ ts: q.completedAt! })),
    dayStartHour: s.dayStartHour,
    since,
  });
}

/**
 * "Reset learned schedule": learning restarts from now. Progress, quests, achievements,
 * work history and every other game datum are kept; pending time-change proposals are dismissed.
 */
export async function resetLearnedSchedule(): Promise<void> {
  const s = await settingsRepository.get();
  if (!s) return;
  await settingsRepository.save({ ...s, routine: { ...s.routine, learnedSince: clock.now() } });
  for (const sug of await suggestionRepository.pending()) if (sug.type === 'scheduleTime') await suggestionRepository.resolve(sug.id, 'declined');
}

// ——— The live picture ———

export interface ContextSnapshot {
  view: DailyContextView;
  ctx: DailyContext;
  openWork?: OpenWork;
  learned: LearnedSchedule;
  opening?: Opening;
}

/** Evaluate the day right now from stored facts (used by the Home, reminders and the Coach). */
export async function contextSnapshot(now = clock.now()): Promise<ContextSnapshot | undefined> {
  const [settings, player] = await Promise.all([settingsRepository.get(), playerRepository.get()]);
  if (!settings || !player) return undefined;
  const today = clock.today();
  const [ctx, openWork, learned, plan, quests, active, history, lastVisit] = await Promise.all([
    getDayContext(today),
    getOpenWork(),
    learnedSchedule(),
    planFor(today, settings),
    questRepository.byDate(today),
    workoutRepository.activeSession(),
    questRepository.byRange(shiftDate(today, -30), today),
    previousVisit(),
  ]);
  const streaks: Record<string, number> = {};
  const byAct = new Map<string, typeof history>();
  for (const q of history) if (q.activityId) byAct.set(q.activityId, [...(byAct.get(q.activityId) ?? []), q]);
  for (const [id, list] of byAct) streaks[id] = activityStreak(list, today);
  const view = evaluateDay({
    now,
    date: today,
    dayStartHour: settings.dayStartHour,
    wake: plan.wake,
    sleep: plan.sleep,
    ctx,
    openWork,
    trainingActive: !!active,
    learned,
    plannedWork: plan.workStatus === 'set' || plan.workStatus === 'partial',
    energy: player.energy,
    maxEnergy: player.maxEnergy,
    quests,
    streaks,
  });
  const opening = dailyOpening({ now, date: today, dayStartHour: settings.dayStartHour, ctx, learned, adaptive: settings.routine.adaptive, askWake: settings.routine.askWake, lastVisit, yesterday: shiftDate(today, -1) });
  return { view, ctx, openWork, learned, opening };
}

// ——— Analytics (context, not competition) ———

export interface WorkDayRow {
  date: ISODate;
  start: number;
  end: number;
  minutes: number;
  edited: boolean;
}

export async function workHistory(days = 30): Promise<{ rows: WorkDayRow[]; avgMinutes?: number; avgStartMin?: number; avgEndMin?: number }> {
  const today = clock.today();
  const contexts = await getDb().dayContexts.where('date').between(shiftDate(today, -days), today, true, true).toArray();
  const rows = contexts.flatMap((c) => c.work.filter((w) => w.end).map((w) => ({ date: c.date, start: w.start, end: w.end!, minutes: w.minutes ?? Math.round((w.end! - w.start) / 60000), edited: !!w.edited }))).sort((a, b) => b.start - a.start);
  if (!rows.length) return { rows };
  const minOf = (ts: number) => {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
  };
  const avg = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  return { rows, avgMinutes: avg(rows.map((r) => r.minutes)), avgStartMin: avg(rows.map((r) => minOf(r.start))), avgEndMin: avg(rows.map((r) => minOf(r.end))) };
}
