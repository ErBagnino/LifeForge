import type { ISODate, TimeHM } from './common';

/**
 * What the player has told us about a piece of information.
 * - `set`: known and usable
 * - `not_set`: never provided (not an error: the app works without it)
 * - `unknown`: the player explicitly said "I don't know yet"
 */
export type Knowledge = 'set' | 'not_set' | 'unknown';

/** How a field is presented in the profile: filled in, still missing, or never required. */
export type FieldStatus = 'set' | 'not_set' | 'optional';

/** One weekday of a work schedule. Every time field is optional: partial knowledge is normal. */
export type WorkDayEntry =
  | { kind: 'off' }
  | {
      kind: 'work';
      start?: TimeHM;
      end?: TimeHM;
      /** Unpaid break inside the block (minutes). */
      breakMin?: number;
      /** Length when only the duration is known ("I work 6 hours"). */
      durationMin?: number;
      /** "Probably", "around": a soft estimate, not a commitment. */
      approximate?: boolean;
    }
  | { kind: 'unknown' };

export interface WorkSchedule {
  id: string;
  /** First game date this schedule applies to (inclusive). */
  effectiveFrom: ISODate;
  /** Index = JS weekday (0 = Sunday). Always 7 entries. */
  days: WorkDayEntry[];
  /** Hours change from week to week (shifts): the planner asks day by day. */
  variable?: boolean;
  note?: string;
  source: 'onboarding' | 'settings' | 'coach' | 'migration';
  createdAt: number;
}

export interface WorkSettings {
  status: Knowledge;
  /** Versions ordered by `effectiveFrom`; the latest one that has started is active. */
  schedules: WorkSchedule[];
}

export type ExceptionKind = 'no_gym' | 'more_time' | 'less_time' | 'keep_all' | 'push';

/** A time-boxed change of availability ("no gym this week", "more time from October"). */
export interface AvailabilityException {
  id: string;
  kind: ExceptionKind;
  from: ISODate;
  /** Inclusive; open-ended when missing. */
  to?: ISODate;
  note?: string;
  createdAt: number;
}

/** How the planner treats a full day. `auto` trims optional work; the others respect the player's call. */
export type LoadMode = 'auto' | 'keep_all' | 'push';

export type KnownField = 'wake' | 'sleep' | 'training' | 'steps' | 'height' | 'weight' | 'goals';

/** Resolved work information for one date. */
export interface ResolvedWork {
  status: 'set' | 'partial' | 'unknown' | 'off';
  start?: TimeHM;
  end?: TimeHM;
  breakMin?: number;
  /** Net work minutes when derivable from what the player said, otherwise undefined. */
  minutes?: number;
  approximate?: boolean;
  /** Where the info came from. */
  source: 'schedule' | 'temporary' | 'none';
  variable?: boolean;
}
