import type { DayLog, ISODate } from '@/types';
import { daysBetween, shiftDate } from '@/utils/date';

/**
 * Seasons: 30-day arcs counted from the adventure start. Season points come from real days
 * (quests done, successful days, workouts) and unlock cosmetic badges. Permanent progress
 * is never touched, nothing expires in a punishing way, and there is nothing to buy.
 */

export const SEASON_DAYS = 30;
const NAMES = ['Foundation', 'Momentum', 'Discipline', 'Growth', 'Balance', 'Mastery', 'Resilience', 'Legacy'];

export const SEASON_MILESTONES = [
  { points: 400, badge: 'Bronze', icon: '🥉' },
  { points: 1000, badge: 'Silver', icon: '🥈' },
  { points: 1800, badge: 'Gold', icon: '🥇' },
  { points: 2800, badge: 'Legend', icon: '🏆' },
] as const;

/** Points per day: 10 per quest done (max 12 counted), 50 for a successful day, 30 per workout. */
export function dayPoints(l: Pick<DayLog, 'core' | 'important' | 'optional' | 'success' | 'closed' | 'workouts'>): number {
  const done = l.core.done + l.important.done + l.optional.done;
  return Math.min(12, done) * 10 + (l.closed && l.success ? 50 : 0) + l.workouts * 30;
}

export interface SeasonState {
  n: number;
  name: string;
  start: ISODate;
  end: ISODate;
  day: number;
  daysLeft: number;
  points: number;
  reached: (typeof SEASON_MILESTONES)[number][];
  next?: (typeof SEASON_MILESTONES)[number];
}

export function seasonFor(adventureStart: ISODate, today: ISODate, logs: Pick<DayLog, 'date' | 'core' | 'important' | 'optional' | 'success' | 'closed' | 'workouts'>[]): SeasonState {
  const dayIndex = Math.max(0, daysBetween(adventureStart, today));
  const n = Math.floor(dayIndex / SEASON_DAYS) + 1;
  const start = shiftDate(adventureStart, (n - 1) * SEASON_DAYS);
  const end = shiftDate(start, SEASON_DAYS - 1);
  const points = logs.filter((l) => l.date >= start && l.date <= end && l.date <= today).reduce((s, l) => s + dayPoints(l), 0);
  const reached = SEASON_MILESTONES.filter((m) => points >= m.points);
  return {
    n,
    name: NAMES[(n - 1) % NAMES.length],
    start,
    end,
    day: dayIndex - (n - 1) * SEASON_DAYS + 1,
    daysLeft: daysBetween(today, end),
    points,
    reached: [...reached],
    next: SEASON_MILESTONES.find((m) => points < m.points),
  };
}

/** Badges from every finished season (for the collection). */
export function pastSeasonBadges(adventureStart: ISODate, today: ISODate, logs: Parameters<typeof seasonFor>[2]): { n: number; name: string; badge?: string; icon?: string }[] {
  const current = seasonFor(adventureStart, today, logs).n;
  const out = [];
  for (let n = 1; n < current; n++) {
    const end = shiftDate(adventureStart, n * SEASON_DAYS - 1);
    const s = seasonFor(adventureStart, end, logs);
    const best = s.reached.at(-1);
    out.push({ n, name: s.name, badge: best?.badge, icon: best?.icon });
  }
  return out;
}
