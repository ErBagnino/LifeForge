import type {
  AvailabilityException,
  DaySchedule,
  DayPlan,
  ExceptionKind,
  ISODate,
  LoadMode,
  ResolvedWork,
  Settings,
  TimeHM,
  WorkDayEntry,
  WorkSchedule,
  WorkSettings,
} from '@/types';
import { blockMinutes, hmToMinutes, minutesToHm, weekday } from '@/utils/date';

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday-first display order of JS weekday indexes. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const EMPTY_WORK: WorkSettings = { status: 'not_set', schedules: [] };

/** The schedule version in force on `date`, if the player has one. */
export function activeSchedule(work: WorkSettings, date: ISODate): WorkSchedule | undefined {
  if (work.status !== 'set') return undefined;
  return [...work.schedules].filter((s) => s.effectiveFrom <= date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
}

/** Schedule versions that start after `date` ("from Monday I work 8–18"). */
export function upcomingSchedules(work: WorkSettings, date: ISODate): WorkSchedule[] {
  return work.schedules.filter((s) => s.effectiveFrom > date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** Turn what the player said about one day into times — only deriving, never assuming. */
export function resolveEntry(entry: WorkDayEntry | undefined): Omit<ResolvedWork, 'source'> {
  if (!entry || entry.kind === 'unknown') return { status: 'unknown' };
  if (entry.kind === 'off') return { status: 'off', minutes: 0 };
  let { start, end } = entry;
  const brk = entry.breakMin ?? 0;
  if (start && !end && entry.durationMin) end = minutesToHm(hmToMinutes(start) + entry.durationMin + brk);
  if (end && !start && entry.durationMin) start = minutesToHm(hmToMinutes(end) - entry.durationMin - brk);
  const minutes = start && end ? Math.max(0, blockMinutes(start, end) - brk) : entry.durationMin;
  return { status: start && end ? 'set' : 'partial', start, end, breakMin: entry.breakMin, minutes, approximate: entry.approximate };
}

/** Work on `date` from the regular (possibly versioned) schedule. */
export function resolveWork(date: ISODate, work: WorkSettings): ResolvedWork {
  const sch = activeSchedule(work, date);
  if (!sch) return { status: 'unknown', source: 'none' };
  return { ...resolveEntry(sch.days[weekday(date)]), source: 'schedule', variable: sch.variable };
}

/** Work info carried by a day plan (temporary overrides and saved plans). */
export function workFromPlan(plan: DayPlan): ResolvedWork {
  const status = plan.workStatus ?? (plan.work ? 'set' : plan.dayType === 'work' ? 'partial' : 'off');
  return {
    status,
    start: plan.work?.start ?? plan.workStart,
    end: plan.work?.end ?? plan.workEnd,
    breakMin: plan.breakMin,
    minutes: plan.workMinutes ?? (plan.work ? Math.max(0, blockMinutes(plan.work.start, plan.work.end) - (plan.breakMin ?? 0)) : status === 'off' ? 0 : undefined),
    approximate: plan.workApproximate,
    source: plan.temporary ? 'temporary' : 'schedule',
  };
}

/** Write resolved work into a plan, keeping everything else. */
export function applyWorkToPlan(plan: DayPlan, w: Pick<ResolvedWork, 'status' | 'start' | 'end' | 'breakMin' | 'minutes' | 'approximate'>): DayPlan {
  const rest = plan.dayType === 'rest';
  const base: DayPlan = {
    ...plan,
    work: undefined,
    workStart: undefined,
    workEnd: undefined,
    workMinutes: undefined,
    breakMin: undefined,
    workApproximate: undefined,
    workStatus: w.status,
  };
  if (w.status === 'off' || w.status === 'unknown') return { ...base, dayType: rest ? 'rest' : 'free' };
  const extra = { workStart: w.start, workEnd: w.end, workMinutes: w.minutes, breakMin: w.breakMin, workApproximate: w.approximate };
  if (w.status === 'set' && w.start && w.end) return { ...base, ...extra, dayType: rest ? 'rest' : 'work', work: { start: w.start, end: w.end, label: 'Work' } };
  return { ...base, ...extra, workStatus: 'partial', dayType: rest ? 'rest' : 'work' };
}

/** The regular week applied to a date (no per-day overrides). */
export function scheduledPlan(date: ISODate, settings: Settings): DayPlan {
  const day: DaySchedule | undefined = settings.schedule.days[weekday(date)];
  const base: DayPlan = {
    date,
    dayType: 'free',
    busy: day?.busy ?? [],
    wake: settings.schedule.wake,
    sleep: settings.schedule.sleep,
    wakeEstimated: settings.known.wake !== 'set',
    sleepEstimated: settings.known.sleep !== 'set',
  };
  return applyWorkToPlan(base, resolveWork(date, settings.work));
}

/** Short human description of a day's work info. */
export function describeWork(w: Pick<ResolvedWork, 'status' | 'start' | 'end' | 'minutes' | 'approximate' | 'breakMin'>): string {
  const approx = w.approximate ? '~' : '';
  switch (w.status) {
    case 'off':
      return 'Free';
    case 'unknown':
      return 'Not set';
    case 'set':
      return `${approx}${w.start}–${w.end}${w.breakMin ? ` · ${w.breakMin}′ break` : ''}`;
    case 'partial':
      if (w.start && !w.end) return `From ${approx}${w.start} · end not set`;
      if (w.end && !w.start) return `Until ${approx}${w.end} · start not set`;
      if (w.minutes) return `${formatHours(w.minutes)} · times not set`;
      return 'Working · hours not set';
  }
}

export function formatHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

export function describeEntry(entry: WorkDayEntry | undefined): string {
  return describeWork(resolveEntry(entry));
}

/** Compact weekly summary: "Mon–Fri 08:00–18:00 · Wed 08:00–14:00 · Weekend free". */
export function summarizeSchedule(days: WorkDayEntry[]): string[] {
  const groups: { label: string; days: number[] }[] = [];
  for (const d of WEEK_ORDER) {
    const label = describeEntry(days[d]);
    const last = groups.at(-1);
    const prevDay = last?.days.at(-1);
    const consecutive = prevDay !== undefined && WEEK_ORDER.indexOf(d) === WEEK_ORDER.indexOf(prevDay) + 1;
    if (last && last.label === label && consecutive) last.days.push(d);
    else groups.push({ label, days: [d] });
  }
  return groups.map((g) => {
    const names = g.days.length === 1 ? WEEKDAY_SHORT[g.days[0]] : `${WEEKDAY_SHORT[g.days[0]]}–${WEEKDAY_SHORT[g.days.at(-1)!]}`;
    const isWeekend = g.days.length === 2 && g.days[0] === 6 && g.days[1] === 0;
    const label = /^\d|^~/.test(g.label) ? g.label : g.label.charAt(0).toLowerCase() + g.label.slice(1);
    return `${isWeekend ? 'Weekend' : names} ${label}`;
  });
}

// ——— Exceptions & load mode ———

export function activeExceptions(list: AvailabilityException[], date: ISODate, kind?: ExceptionKind): AvailabilityException[] {
  return list.filter((e) => e.from <= date && (!e.to || e.to >= date) && (!kind || e.kind === kind));
}

/** Multiplier for "I'll have more / less time" periods. */
export function capacityAdjustment(list: AvailabilityException[], date: ISODate): number {
  return activeExceptions(list, date).reduce((f, e) => (e.kind === 'more_time' ? f * 1.25 : e.kind === 'less_time' ? f * 0.75 : f), 1);
}

export function loadModeFor(settings: Pick<Settings, 'exceptions' | 'load'>, date: ISODate): LoadMode {
  const active = activeExceptions(settings.exceptions, date);
  if (active.some((e) => e.kind === 'push')) return 'push';
  if (active.some((e) => e.kind === 'keep_all')) return 'keep_all';
  return settings.load.mode;
}

export function gymBlocked(settings: Pick<Settings, 'exceptions'>, date: ISODate): boolean {
  return activeExceptions(settings.exceptions, date, 'no_gym').length > 0;
}

// ——— Migration ———

const OLD_DEFAULT = { start: '09:00', end: '19:00' };

/**
 * Settings v1 stored work inside the weekly schedule and shipped with an assumed
 * Mon–Fri 09:00–19:00 job. An untouched default becomes "not set"; anything the
 * player customised is kept as a real schedule.
 */
export function migrateWork(days: DaySchedule[] | undefined, now: number): WorkSettings {
  if (!days?.length) return { ...EMPTY_WORK };
  const isOldDefault = days.every((d, i) =>
    i === 0 || i === 6 ? d.type !== 'work' : d.type === 'work' && d.work?.start === OLD_DEFAULT.start && d.work?.end === OLD_DEFAULT.end,
  );
  if (isOldDefault) return { ...EMPTY_WORK };
  return {
    status: 'set',
    schedules: [
      {
        id: 'ws_migrated',
        effectiveFrom: '2000-01-01',
        days: days.map((d): WorkDayEntry => (d.type === 'work' && d.work ? { kind: 'work', start: d.work.start, end: d.work.end } : { kind: 'off' })),
        source: 'migration',
        createdAt: now,
      },
    ],
  };
}

/** A fresh 7-day schedule where every day is unknown. */
export function blankWeek(fill: WorkDayEntry = { kind: 'unknown' }): WorkDayEntry[] {
  return Array.from({ length: 7 }, () => ({ ...fill }));
}

export function isTime(v: unknown): v is TimeHM {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
