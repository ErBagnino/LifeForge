import type {
  DayType,
  DifficultyState,
  ID,
  ISODate,
  MetricMap,
  MetricType,
  TimeBlock,
  TimeHM,
  Timestamp,
  WorkloadLevel,
} from './common';

export type ScoreComponentKey =
  | 'core'
  | 'important'
  | 'optional'
  | 'physical'
  | 'nutrition'
  | 'hydration'
  | 'routine'
  | 'consistency';

export interface ScoreComponent {
  key: ScoreComponentKey;
  weight: number;
  /** 0..1, or null when the component does not apply today (weight is redistributed). */
  ratio: number | null;
}

export interface ScoreBreakdown {
  components: ScoreComponent[];
  base: number;
  bonus: number;
  total: number;
}

export interface TierCount {
  done: number;
  total: number;
}

export interface PenaltyRecord {
  kind: 'hp' | 'coins' | 'xp' | 'debuff' | 'streak';
  amount: number;
  reason: string;
}

export interface DayLog {
  date: ISODate;
  dayType: DayType;
  restDay: boolean;
  sick: boolean;
  score: number;
  breakdown?: ScoreBreakdown;
  xp: number;
  coins: number;
  core: TierCount;
  important: TierCount;
  optional: TierCount;
  workload: number;
  workloadLevel: WorkloadLevel;
  difficultyState: DifficultyState;
  energyStart: number;
  hpStart: number;
  hpEnd?: number;
  metrics: MetricMap;
  achievements: ID[];
  workouts: number;
  levelUps: number[];
  success: boolean;
  streak: number;
  closed: boolean;
  closedAt?: Timestamp;
  penalties: PenaltyRecord[];
  worldIncome?: number;
  /** 7-day success ratio captured at day start (null without history). */
  consistency7d?: number | null;
  /** HP gained from quests today (for the daily gain cap). */
  hpFromQuests?: number;
  /** Routine ids whose completion bonus was already granted today. */
  routinesDone?: string[];
  /** Smart rule ids already fired today. */
  rulesFired?: string[];
  reviewed?: boolean;
  notes?: string;
  /** Daily capacity (minutes of quest time) estimated at day start. */
  capacityMin?: number;
  /** Minutes of core + important quests planned after balancing. */
  plannedMin?: number;
  /** Minutes of quests actually completed (set at day close). */
  completedMin?: number;
  /** Free minutes (awake − work − busy) when work was known. */
  freeMin?: number;
  workStatus?: DayPlan['workStatus'];
  /** Day number since the adventure started (0 = day 1). */
  dayIndex?: number;
}

/** Where a metric came from. Missing means manual entry; `health` is reserved for a future HealthKit bridge. */
export type MetricSource = 'manual' | 'timer' | 'health' | 'import';

export interface MetricEntry {
  id: ID;
  date: ISODate;
  type: MetricType;
  value: number;
  ts: Timestamp;
  note?: string;
  source?: MetricSource;
  /** The meal this entry belongs to (deleting the meal removes it). */
  refId?: ID;
}

export interface MealItem {
  name: string;
  grams?: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A logged meal: its macros are also written as metric entries (refId = meal id). */
export interface Meal {
  id: ID;
  date: ISODate;
  ts: Timestamp;
  name: string;
  items: MealItem[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Small JPEG data URL (≈320 px) when logged from a photo. */
  photo?: string;
  source: 'manual' | 'preset' | 'photo' | 'ai';
  note?: string;
}

/** A per-day override of the weekly schedule. */
export interface DayPlan {
  date: ISODate;
  dayType: DayType;
  /** Fully known work block (start and end). */
  work?: TimeBlock;
  /** What is known about work today. Missing on old plans = derive from `work`. */
  workStatus?: 'set' | 'partial' | 'unknown' | 'off';
  /** Partial knowledge ("starts at 9, end unknown"). */
  workStart?: TimeHM;
  workEnd?: TimeHM;
  /** Net work minutes when known. */
  workMinutes?: number;
  breakMin?: number;
  workApproximate?: boolean;
  /** One-off schedule for this date only (does not touch the regular week). */
  temporary?: boolean;
  note?: string;
  busy: TimeBlock[];
  wake: TimeHM;
  sleep: TimeHM;
  /** Planning estimates, not values the player gave. */
  wakeEstimated?: boolean;
  sleepEstimated?: boolean;
}

export interface LedgerEntry {
  id: ID;
  ts: Timestamp;
  date: ISODate;
  type: 'xp' | 'coins' | 'hp' | 'energy';
  amount: number;
  reason: string;
  refId?: ID;
}
