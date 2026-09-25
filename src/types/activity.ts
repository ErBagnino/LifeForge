import type {
  ActivityCategory,
  Difficulty,
  ID,
  Importance,
  MetricType,
  QuestTier,
  StatMap,
  TimeHM,
  TimeOfDay,
  Timestamp,
} from './common';

/**
 * How often an activity becomes a quest.
 * Weekdays use JS numbering: 0 = Sunday … 6 = Saturday.
 */
export type Recurrence =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }
  | { type: 'timesPerWeek'; times: number }
  | { type: 'everyNDays'; n: number }
  /** Never scheduled automatically: available to the side-quest generator or manual start. */
  | { type: 'pool' };

/** Lets the generator size a quest to the time available ("5 MIN ROOM RESET" vs "15 MIN"). */
export interface ScalableSpec {
  field: 'duration' | 'quantity';
  min: number;
  max: number;
  step: number;
}

export interface SafetyLimits {
  /** Lowest target the adaptive system may propose. */
  min?: number;
  /** Highest target the adaptive system may propose. */
  max?: number;
  /** Max relative increase per adaptation step, in percent. */
  maxIncreasePct?: number;
}

export type AvailableOn = 'any' | 'workday' | 'freeday';

export interface Activity {
  id: ID;
  name: string;
  icon: string;
  category: ActivityCategory;
  description?: string;
  tier: QuestTier;
  importance: Importance;
  difficulty: Difficulty;
  recurrence: Recurrence;
  timeOfDay: TimeOfDay;
  preferredTime?: TimeHM;
  durationMin: number;
  /** Target quantity, e.g. 2000 (ml) or 7000 (steps). */
  quantity?: number;
  unit?: string;
  /** When set, quest progress follows the logged metric automatically. */
  metric?: MetricType;
  /** 'atMost' = stay under the target (e.g. play-time budget). Default 'atLeast'. */
  metricMode?: 'atLeast' | 'atMost';
  /** Overrides for the centrally computed values. */
  baseXp?: number;
  baseCoins?: number;
  /** Negative values restore energy (recovery activities). */
  energyCost?: number;
  stats: StatMap;
  adaptive: boolean;
  active: boolean;
  streakEligible: boolean;
  generatorEligible: boolean;
  scalable?: ScalableSpec;
  availableOn?: AvailableOn;
  userCreated: boolean;
  aiImported: boolean;
  safety?: SafetyLimits;
  /** Building id required before the generator may propose it. */
  requiresBuilding?: string;
  notes?: string;
  tags?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RoutineKind = 'morning' | 'night' | 'workout' | 'recovery' | 'custom';

export interface Routine {
  id: ID;
  name: string;
  icon: string;
  kind: RoutineKind;
  activityIds: ID[];
  timeOfDay: TimeOfDay;
  startTime?: TimeHM;
  active: boolean;
  bonusXp: number;
  bonusCoins: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
