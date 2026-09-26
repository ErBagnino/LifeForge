import type { DailyContext, ISODate, Quest, TimeHM } from '@/types';
import { gameMinutes, minuteOfDay, minutesToHm, weekday } from '@/utils/date';
import { median } from '@/utils/math';

/**
 * DAILY CONTEXT ENGINE (pure).
 *
 * Works out where the player is in their day — from facts they gave (wake-up,
 * START/END WORK, an active workout), the clock and learned habits — and decides
 * what matters now: which quests to show, which to hold during work, what still
 * realistically fits before bed, and in which order. No GPS, no background tracking:
 * only what happens in the app.
 */

export type ContextState = 'SLEEP' | 'WAKE_UP' | 'MORNING' | 'AFTERNOON' | 'WEEKEND' | 'WORK' | 'POST_WORK' | 'TRAINING' | 'EVENING' | 'WIND_DOWN';

export const STATE_INFO: Record<ContextState, { icon: string; label: string; greeting: string }> = {
  SLEEP: { icon: '😴', label: 'Sleep', greeting: 'Rest well' },
  WAKE_UP: { icon: '☀️', label: 'Wake-up', greeting: 'Good morning' },
  MORNING: { icon: '☀️', label: 'Morning', greeting: 'Good morning' },
  AFTERNOON: { icon: '🌤️', label: 'Afternoon', greeting: 'Good afternoon' },
  WEEKEND: { icon: '🌿', label: 'Weekend', greeting: 'Happy weekend' },
  WORK: { icon: '💼', label: 'Working', greeting: 'Focus on work' },
  POST_WORK: { icon: '🏠', label: 'Post-work', greeting: 'Welcome back' },
  TRAINING: { icon: '🏋️', label: 'Training', greeting: 'Train hard' },
  EVENING: { icon: '🌙', label: 'Evening', greeting: 'Good evening' },
  WIND_DOWN: { icon: '🌙', label: 'Wind down', greeting: 'Time to wind down' },
};

export type Priority = 'CRITICAL' | 'IMPORTANT' | 'NORMAL' | 'OPTIONAL';

// ——— Learning ———

export interface MinuteStat {
  median: number;
  count: number;
}

export interface WorkDayStat {
  count: number;
  /** Days on this weekday the app was used (for "usually works on Mondays"). */
  observed: number;
  start?: number;
  end?: number;
  minutes?: number;
}

export interface LearnedSchedule {
  wake: { weekday?: MinuteStat; weekend?: MinuteStat; all?: MinuteStat };
  work: {
    byWeekday: WorkDayStat[];
    /** Weekdays the player usually works (≥3 sessions and ≥60 % of observed days). */
    workdays: number[];
    avgStart?: number;
    avgEnd?: number;
    avgMinutes?: number;
    sessions: number;
  };
  meals: { breakfast?: MinuteStat; lunch?: MinuteStat; dinner?: MinuteStat };
  workout?: MinuteStat;
}

export const MIN_OBSERVATIONS = 3;

const stat = (minutes: number[]): MinuteStat | undefined => (minutes.length >= MIN_OBSERVATIONS ? { median: Math.round(median(minutes)), count: minutes.length } : undefined);

/** Minute of the day for a timestamp, measured on the game day (after-midnight stays late: 00:30 → 1470). */
export function gameMinuteOf(ts: number, dayStartHour: number): number {
  const m = minuteOfDay(ts);
  return m < dayStartHour * 60 ? m + 1440 : m;
}

export function isWeekendDate(date: ISODate): boolean {
  const d = weekday(date);
  return d === 0 || d === 6;
}

/**
 * Learn wake-up, work, meal and workout patterns. Nothing is learned from fewer than
 * MIN_OBSERVATIONS events; weekdays and weekends are learned separately.
 */
export function learnSchedule(input: {
  contexts: DailyContext[];
  meals: { ts: number }[];
  workouts: { ts: number }[];
  dayStartHour: number;
  since?: number;
}): LearnedSchedule {
  const since = input.since ?? 0;
  const dsh = input.dayStartHour;
  const ctxs = input.contexts.filter((c) => c.updatedAt >= since || (c.firstOpenAt ?? 0) >= since);
  const wakes = ctxs.filter((c) => c.wakeUpTime && c.wakeUpTime >= since && c.wakeSource !== 'estimated');
  const wakeMin = (list: DailyContext[]) => list.map((c) => gameMinuteOf(c.wakeUpTime!, dsh));
  const byWeekday: WorkDayStat[] = Array.from({ length: 7 }, () => ({ count: 0, observed: 0 }));
  const starts: number[][] = Array.from({ length: 7 }, () => []);
  const ends: number[][] = Array.from({ length: 7 }, () => []);
  const mins: number[][] = Array.from({ length: 7 }, () => []);
  for (const c of ctxs) {
    const wd = weekday(c.date);
    if (c.firstOpenAt || c.work.length) byWeekday[wd].observed += 1;
    const done = c.work.filter((w) => w.end && w.start >= since);
    if (!done.length) continue;
    byWeekday[wd].count += 1;
    starts[wd].push(gameMinuteOf(done[0].start, dsh));
    ends[wd].push(gameMinuteOf(done[done.length - 1].end!, dsh));
    mins[wd].push(done.reduce((s, w) => s + (w.minutes ?? Math.round((w.end! - w.start) / 60000)), 0));
  }
  for (let d = 0; d < 7; d++) {
    if (starts[d].length) {
      byWeekday[d].start = Math.round(median(starts[d]));
      byWeekday[d].end = Math.round(median(ends[d]));
      byWeekday[d].minutes = Math.round(median(mins[d]));
    }
  }
  const allStarts = starts.flat();
  const bucket = (from: number, to: number) => input.meals.filter((m) => m.ts >= since).map((m) => minuteOfDay(m.ts)).filter((m) => m >= from && m < to);
  return {
    wake: {
      weekday: stat(wakeMin(wakes.filter((c) => !isWeekendDate(c.date)))),
      weekend: stat(wakeMin(wakes.filter((c) => isWeekendDate(c.date)))),
      all: stat(wakeMin(wakes)),
    },
    work: {
      byWeekday,
      workdays: byWeekday.map((s, d) => (s.count >= MIN_OBSERVATIONS && s.count / Math.max(1, s.observed) >= 0.6 ? d : -1)).filter((d) => d >= 0),
      avgStart: allStarts.length >= MIN_OBSERVATIONS ? Math.round(median(allStarts)) : undefined,
      avgEnd: ends.flat().length >= MIN_OBSERVATIONS ? Math.round(median(ends.flat())) : undefined,
      avgMinutes: mins.flat().length >= MIN_OBSERVATIONS ? Math.round(median(mins.flat())) : undefined,
      sessions: allStarts.length,
    },
    meals: { breakfast: stat(bucket(4 * 60, 11 * 60)), lunch: stat(bucket(11 * 60, 15 * 60 + 30)), dinner: stat(bucket(17 * 60, 23 * 60 + 30)) },
    workout: stat(input.workouts.filter((w) => w.ts >= since).map((w) => gameMinuteOf(w.ts, dsh))),
  };
}

/** Typical wake-up for a date: weekday/weekend pattern first, then all days. */
export function typicalWake(l: LearnedSchedule, date: ISODate): MinuteStat | undefined {
  return (isWeekendDate(date) ? l.wake.weekend : l.wake.weekday) ?? l.wake.all;
}

/** Expected work for a date from the learned pattern (never forced: no START = no work). */
export function expectedWork(l: LearnedSchedule, date: ISODate): WorkDayStat | undefined {
  const wd = weekday(date);
  return l.work.workdays.includes(wd) ? l.work.byWeekday[wd] : undefined;
}

// ——— State ———

export interface ContextInput {
  now: number;
  date: ISODate;
  dayStartHour: number;
  /** Planned wake/bed times (manual, or planning defaults). */
  wake: TimeHM;
  sleep: TimeHM;
  ctx?: DailyContext;
  /** Open work session (the timer survives closing the app). */
  openWork?: { start: number };
  trainingActive?: boolean;
  learned?: LearnedSchedule;
  /** Plan says today is a workday (regular schedule or one-off). */
  plannedWork?: boolean;
  energy: number;
  maxEnergy: number;
  quests: Quest[];
  /** activityId → current completion streak. */
  streaks?: Record<string, number>;
}

export interface QuestDecision {
  quest: Quest;
  priority: Priority;
  score: number;
  reason: string;
  /** Held back while working (never counted as failed). */
  suspended: boolean;
  /** Fits in the time left today (in priority order). */
  realistic: boolean;
  /** Low energy: a lighter option instead of skipping. */
  alternative?: { label: string; durationMin: number };
}

export interface DailyContextView {
  state: ContextState;
  /** Minutes from now until bedtime (0 after bedtime). */
  minutesToBed: number;
  /** Minutes of that still busy (work in progress or still expected today). */
  busyAhead: number;
  /** Realistically available minutes today. */
  availableMin: number;
  /** Minutes of pending quests that still matter. */
  plannedMin: number;
  /** Pending quests fit in the available time. */
  fits: boolean;
  /** 0–100: how much room the day has right now (internal, for the decision engine). */
  contextScore: number;
  decisions: QuestDecision[];
  /** Short prioritized list for the Home ("what matters now"). */
  focus: QuestDecision[];
  workMinutes: number;
  workedToday: boolean;
  lastWorkEnd?: number;
  wakeUpTime?: number;
}

const WORK_CAP_MIN = 16 * 60;

export function workMinutesToday(ctx: DailyContext | undefined, openWork: { start: number } | undefined, now: number): number {
  const closed = (ctx?.work ?? []).filter((w) => w.end).reduce((s, w) => s + (w.minutes ?? Math.round((w.end! - w.start) / 60000)), 0);
  const running = openWork ? Math.min(WORK_CAP_MIN, Math.max(0, Math.round((now - openWork.start) / 60000))) : 0;
  return closed + running;
}

export function computeState(i: Pick<ContextInput, 'now' | 'date' | 'dayStartHour' | 'wake' | 'sleep' | 'ctx' | 'openWork' | 'trainingActive'>): ContextState {
  const dsh = i.dayStartHour;
  const now = gameMinuteOf(i.now, dsh);
  const wake = gameMinutes(i.wake, dsh);
  const bed = gameMinutes(i.sleep, dsh);
  if (i.openWork) return 'WORK';
  if (i.trainingActive) return 'TRAINING';
  if (now >= bed) return 'SLEEP';
  const woke = i.ctx?.wakeUpTime;
  if (!woke && now < wake - 60) return 'SLEEP';
  if (now >= bed - 60) return 'WIND_DOWN';
  const lastEnd = lastWorkEnd(i.ctx);
  if (lastEnd && i.now - lastEnd < 90 * 60_000) return 'POST_WORK';
  if (woke ? i.now - woke < 45 * 60_000 : Math.abs(now - wake) <= 60 && now < 12 * 60) return 'WAKE_UP';
  if (now >= 19 * 60) return 'EVENING';
  if (isWeekendDate(i.date) && !(i.ctx?.work.length ?? 0)) return 'WEEKEND';
  return now < 12 * 60 ? 'MORNING' : 'AFTERNOON';
}

function lastWorkEnd(ctx?: DailyContext): number | undefined {
  const ends = (ctx?.work ?? []).map((w) => w.end).filter((x): x is number => !!x);
  return ends.length ? Math.max(...ends) : undefined;
}

const HEAVY = new Set(['fitness', 'cardio']);
const MORNING_CATS = new Set(['personal_care', 'skincare', 'hydration', 'nutrition', 'body']);
const EVENING_CATS = new Set(['skincare', 'personal_care', 'sleep', 'rest', 'reading', 'mental_wellbeing']);
const WEEKEND_CATS = new Set(['home', 'cleaning', 'order', 'outdoor', 'social']);

/** Context-aware priority of one quest (internal score + CRITICAL/IMPORTANT/NORMAL/OPTIONAL). */
export function prioritize(q: Quest, i: ContextInput, state: ContextState, minutesLeft: number): { score: number; priority: Priority; reason: string } {
  const reasons: { text: string; w: number }[] = [];
  let score = q.tier === 'core' ? 60 : q.tier === 'important' ? 40 : 15;
  const streak = q.activityId ? (i.streaks?.[q.activityId] ?? 0) : 0;
  if (streak >= 3) {
    const b = streak >= 7 ? 25 : 15;
    score += b;
    reasons.push({ text: `${streak}-day streak on the line`, w: b });
  }
  if (q.kind === 'workout') {
    score += 8;
    reasons.push({ text: 'Planned workout', w: 5 });
  }
  if (q.kind === 'challenge') score += 5;
  if (q.target && q.progress > 0 && q.progress < q.target) {
    score += 6;
    reasons.push({ text: 'Already in progress', w: 6 });
  }
  const now = gameMinuteOf(i.now, i.dayStartHour);
  if (q.scheduledTime) {
    const diff = gameMinutes(q.scheduledTime, i.dayStartHour) - now;
    if (diff >= -30 && diff <= 60) {
      score += 12;
      reasons.push({ text: `Planned around ${q.scheduledTime}`, w: 12 });
    } else if (diff < -30) score += 6;
  }
  // Deadline pressure: the day is running out for this quest.
  if (q.tier !== 'optional' && q.durationMin > 0 && minutesLeft - q.durationMin < 45) {
    score += 18;
    reasons.push({ text: 'Not much day left for this', w: 18 });
  }
  const pct = i.maxEnergy > 0 ? i.energy / i.maxEnergy : 1;
  const heavy = HEAVY.has(q.category) || q.difficulty >= 4;
  if (heavy && pct < 0.3 && q.tier !== 'core') score -= 12;
  if (q.energyCost > i.energy && q.tier !== 'core') score -= 10;
  // Time of day affinity.
  if ((state === 'WAKE_UP' || state === 'MORNING') && MORNING_CATS.has(q.category)) {
    score += 8;
    reasons.push({ text: 'Morning routine', w: 8 });
  }
  if ((state === 'POST_WORK' || state === 'AFTERNOON' || state === 'WEEKEND') && HEAVY.has(q.category) && pct >= 0.3) {
    score += 12;
    reasons.push({ text: state === 'POST_WORK' ? 'Best window after work' : 'Good time to train', w: 12 });
  }
  if ((state === 'EVENING' || state === 'WIND_DOWN') && EVENING_CATS.has(q.category)) {
    score += state === 'WIND_DOWN' ? 18 : 8;
    reasons.push({ text: 'Evening routine', w: 10 });
  }
  if (state === 'WIND_DOWN' && heavy) score -= 25;
  if (state === 'WEEKEND' && WEEKEND_CATS.has(q.category)) score += 6;
  score -= Math.min(12, q.snoozeCount * 3);
  const critical = (q.tier === 'core' && (streak >= 3 || minutesLeft - q.durationMin < 45)) || score >= 85;
  const priority: Priority = critical ? 'CRITICAL' : score >= 55 ? 'IMPORTANT' : score >= 28 ? 'NORMAL' : 'OPTIONAL';
  reasons.sort((a, b) => b.w - a.w);
  return { score, priority, reason: reasons[0]?.text ?? (q.tier === 'core' ? 'Core quest' : q.tier === 'important' ? 'Important today' : 'Optional extra') };
}

/** A lighter version for low-energy moments (offered, never applied automatically). */
export function lowEnergyAlternative(q: Quest, energyPct: number): QuestDecision['alternative'] {
  if (energyPct >= 0.3 || q.durationMin < 30) return undefined;
  if (q.category === 'cardio') return { label: 'Recovery walk · 20 min', durationMin: 20 };
  if (q.category === 'fitness' || q.kind === 'workout') return { label: 'Reduced session · 20 min', durationMin: 20 };
  return undefined;
}

/**
 * The full picture for right now: state, time budget and a decision per pending quest.
 * During WORK every pending quest is held (not failed); afterwards they come back if
 * they still fit before bedtime.
 */
export function evaluateDay(i: ContextInput): DailyContextView {
  const dsh = i.dayStartHour;
  const state = computeState(i);
  const now = gameMinuteOf(i.now, dsh);
  const bed = gameMinutes(i.sleep, dsh);
  const minutesToBed = Math.max(0, bed - now);
  const exp = i.learned ? expectedWork(i.learned, i.date) : undefined;
  let busyAhead = 0;
  if (i.openWork) {
    const typical = exp?.minutes ?? i.learned?.work.avgMinutes;
    const elapsed = Math.round((i.now - i.openWork.start) / 60000);
    busyAhead = typical ? Math.max(0, typical - elapsed) : 0;
  } else if (!(i.ctx?.work.length ?? 0) && !i.ctx?.noWork && (exp || i.plannedWork) && exp?.start !== undefined && now < exp.start) {
    busyAhead = exp.minutes ?? 0;
  }
  busyAhead = Math.min(busyAhead, minutesToBed);
  const availableMin = Math.max(0, minutesToBed - busyAhead);
  const pending = i.quests.filter((q) => q.status === 'pending' && !q.hidden && !q.goal && q.kind !== 'weekly' && q.kind !== 'boss' && (!q.snoozedUntil || q.snoozedUntil <= i.now || gameMinuteOf(q.snoozedUntil, dsh) < bed));
  const pct = i.maxEnergy > 0 ? i.energy / i.maxEnergy : 1;
  const scored = pending
    .map((q) => ({ q, ...prioritize(q, i, state, availableMin) }))
    .sort((a, b) => b.score - a.score || (a.q.scheduledTime ?? '99').localeCompare(b.q.scheduledTime ?? '99'));
  let used = 0;
  const decisions: QuestDecision[] = scored.map((s) => {
    const dur = s.q.target && s.q.metric ? 0 : s.q.durationMin; // metric quests (steps, water) progress by themselves
    const fitsHere = used + dur <= availableMin;
    if (fitsHere || s.priority === 'CRITICAL') used += dur;
    return {
      quest: s.q,
      priority: s.priority,
      score: s.score,
      reason: s.reason,
      suspended: state === 'WORK',
      realistic: state !== 'SLEEP' && (fitsHere || (s.priority === 'CRITICAL' && dur <= minutesToBed)),
      alternative: lowEnergyAlternative(s.q, pct),
    };
  });
  const plannedMin = decisions.filter((d) => d.priority !== 'OPTIONAL').reduce((s, d) => s + (d.quest.target && d.quest.metric ? 0 : d.quest.durationMin), 0);
  const focus = state === 'WORK' || state === 'SLEEP' ? [] : decisions.filter((d) => d.realistic && d.priority !== 'OPTIONAL').slice(0, state === 'WIND_DOWN' ? 3 : 4);
  const ratio = availableMin > 0 ? plannedMin / availableMin : plannedMin > 0 ? 9 : 0;
  const contextScore = Math.round(Math.max(0, Math.min(100, 100 - ratio * 60)) * (0.5 + 0.5 * pct));
  return {
    state,
    minutesToBed,
    busyAhead,
    availableMin,
    plannedMin,
    fits: plannedMin <= availableMin,
    contextScore,
    decisions,
    focus,
    workMinutes: workMinutesToday(i.ctx, i.openWork, i.now),
    workedToday: !!i.ctx?.work.some((w) => w.end) || !!i.openWork,
    lastWorkEnd: lastWorkEnd(i.ctx),
    wakeUpTime: i.ctx?.wakeUpTime,
  };
}

// ——— Daily opening ———

export type WakePrompt = { kind: 'ask' } | { kind: 'confirm'; suggested: TimeHM } | { kind: 'none' };
export type OpeningKind = 'morning' | 'afternoon' | 'evening' | 'night';

export interface Opening {
  kind: OpeningKind;
  wake: WakePrompt;
  /** Last visit was before yesterday: say "Welcome back" and show only known facts. */
  welcomeBack: boolean;
  lastVisit?: ISODate;
  late: boolean;
}

/**
 * What the first open of the day shows. A web app can't know when the player wakes
 * up, so it asks — or, with enough history, proposes the typical time to confirm.
 * Nothing is recorded without an explicit answer.
 */
export function dailyOpening(i: { now: number; date: ISODate; dayStartHour: number; ctx?: DailyContext; learned?: LearnedSchedule; adaptive: boolean; askWake: boolean; lastVisit?: ISODate; yesterday: ISODate }): Opening | undefined {
  if (i.ctx?.dayStartedAt) return undefined;
  const now = gameMinuteOf(i.now, i.dayStartHour);
  const kind: OpeningKind = now < 12 * 60 ? 'morning' : now < 17 * 60 ? 'afternoon' : now < 23 * 60 ? 'evening' : 'night';
  let wake: WakePrompt = { kind: 'none' };
  const askedRecently = i.ctx?.wakeAskedAt && i.now - i.ctx.wakeAskedAt < 60 * 60_000;
  if (i.askWake && !i.ctx?.wakeUpTime && kind === 'morning' && !askedRecently) {
    const t = i.adaptive && i.learned ? typicalWake(i.learned, i.date) : undefined;
    wake = t && Math.abs(now - t.median) <= 75 ? { kind: 'confirm', suggested: minutesToHm(Math.round(t.median / 5) * 5) } : { kind: 'ask' };
  }
  return { kind, wake, welcomeBack: !!i.lastVisit && i.lastVisit < i.yesterday, lastVisit: i.lastVisit, late: kind !== 'morning' };
}

/** "8h 21m" */
export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** Minute (possibly > 1440 after midnight) → "HH:MM". */
export function hm(minute: number): TimeHM {
  return minutesToHm(((Math.round(minute) % 1440) + 1440) % 1440);
}

/** Context for smart postpone: when work should end, usual dinner, next Saturday. */
export function postponeContext(i: { now: number; date: ISODate; dayStartHour: number; openWork?: { start: number }; ctx?: DailyContext; learned?: LearnedSchedule }): { workEndMin?: number; dinnerMin?: number; weekendDate?: ISODate } {
  const exp = i.learned ? expectedWork(i.learned, i.date) : undefined;
  let workEndMin: number | undefined;
  if (i.openWork) {
    const typical = exp?.minutes ?? i.learned?.work.avgMinutes;
    if (typical) workEndMin = gameMinuteOf(i.openWork.start, i.dayStartHour) + typical;
  } else if (exp?.end !== undefined && !(i.ctx?.work.length ?? 0) && !i.ctx?.noWork) workEndMin = exp.end;
  const wd = weekday(i.date);
  const weekendDate = wd >= 1 && wd <= 4 ? shiftIso(i.date, 6 - wd) : undefined; // Mon–Thu → Saturday
  return { workEndMin, dinnerMin: i.learned?.meals.dinner?.median, weekendDate };
}

function shiftIso(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
