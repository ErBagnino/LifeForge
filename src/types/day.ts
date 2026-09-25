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
}

/** A per-day override of the weekly schedule. */
export interface DayPlan {
  date: ISODate;
  dayType: DayType;
  work?: TimeBlock;
  busy: TimeBlock[];
  wake: TimeHM;
  sleep: TimeHM;
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
