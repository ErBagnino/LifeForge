import type { Activity, DayType, ISODate } from '@/types';
import { daysBetween, weekday } from '@/utils/date';
import { hashString } from '@/utils/math';

/** Deterministic 0..n-1 offset per activity so first occurrences don't all land on day one. */
function offset(id: string, n: number): number {
  return hashString(id) % Math.max(1, n);
}

export interface RecurrenceContext {
  date: ISODate;
  dayType: DayType;
  trainingAvailable: boolean;
  /** Completions of this activity in the current ISO week (before today). */
  completedThisWeek: number;
  lastCompletedDate?: ISODate;
  /** Days left in the week including today (Mon = 7 … Sun = 1). */
  daysLeftInWeek: number;
  /** Free (non-work) days remaining in the week after today — chores prefer those. */
  freeDaysLeftAfterToday?: number;
  /** A strength workout is already planned today. */
  workoutToday?: boolean;
}

const TRAINING_CATEGORIES = new Set(['fitness', 'cardio']);

export function daysLeftInWeek(date: ISODate): number {
  const wd = weekday(date);
  return wd === 0 ? 1 : 8 - wd;
}

/** Is the activity due as a quest on this date? */
export function isDueOn(activity: Activity, ctx: RecurrenceContext): boolean {
  if (!activity.active) return false;
  if (activity.availableOn === 'workday' && ctx.dayType !== 'work') return false;
  if (activity.availableOn === 'freeday' && ctx.dayType === 'work') return false;
  const training = TRAINING_CATEGORIES.has(activity.category);
  if (ctx.dayType === 'rest' && (training || activity.tier === 'optional')) return false;

  const r = activity.recurrence;
  switch (r.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return r.days.includes(weekday(ctx.date));
    case 'everyNDays': {
      if (!ctx.lastCompletedDate) {
        const day = Math.floor(Date.parse(`${ctx.date}T12:00:00Z`) / 86400000);
        return (day + offset(activity.id, r.n)) % r.n === 0 || r.n <= 2;
      }
      return daysBetween(ctx.lastCompletedDate, ctx.date) >= r.n;
    }
    case 'timesPerWeek': {
      if (training && !ctx.trainingAvailable) return false;
      const remaining = r.times - ctx.completedThisWeek;
      if (remaining <= 0) return false;
      if (remaining >= ctx.daysLeftInWeek) return true;
      // Chores prefer free days when enough of them are left this week.
      if (!training && ctx.dayType === 'work' && ctx.freeDaysLeftAfterToday !== undefined && remaining <= ctx.freeDaysLeftAfterToday) return false;
      // Cardio avoids strength days when there is room elsewhere.
      if (training && ctx.workoutToday && remaining < ctx.daysLeftInWeek - 1) return false;
      const gap = Math.max(1, Math.floor(7 / r.times));
      if (!ctx.lastCompletedDate) return (weekday(ctx.date) + offset(activity.id, gap)) % gap === 0;
      return daysBetween(ctx.lastCompletedDate, ctx.date) >= gap;
    }
    case 'pool':
      return false;
  }
}

export function describeRecurrence(activity: Pick<Activity, 'recurrence'>): string {
  const r = activity.recurrence;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (r.type) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return r.days.length === 7 ? 'Every day' : [...r.days].sort().map((d) => names[d]).join(' · ');
    case 'timesPerWeek':
      return `${r.times}× per week`;
    case 'everyNDays':
      return r.n === 1 ? 'Every day' : `Every ${r.n} days`;
    case 'pool':
      return 'On demand / side quest';
  }
}
