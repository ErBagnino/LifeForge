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
  reviewed?: boolean;
  notes?: string;
}

export interface MetricEntry {
  id: ID;
  date: ISODate;
  type: MetricType;
  value: number;
  ts: Timestamp;
  note?: string;
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
