import type {
  ActivityCategory,
  Difficulty,
  ID,
  ISODate,
  MetricType,
  QuestTier,
  Rarity,
  StatMap,
  TimeHM,
  Timestamp,
} from './common';

export type QuestKind =
  | 'scheduled'
  | 'workout'
  | 'side'
  | 'challenge'
  | 'hidden'
  | 'weekly'
  | 'boss'
  | 'manual'
  | 'first';

export type QuestStatus = 'pending' | 'completed' | 'skipped' | 'failed' | 'moved';

export type SkipReason = 'tired' | 'no_time' | 'sick' | 'not_needed' | 'other';

/** Declarative goal used by weekly, boss, hidden and challenge quests. */
export type QuestGoal =
  | { type: 'completeCount'; count: number; category?: ActivityCategory; tier?: QuestTier; kinds?: QuestKind[] }
  | { type: 'metricSum'; metric: MetricType; target: number }
  | { type: 'metricDays'; metric: MetricType; days: number }
  | { type: 'perfectCoreDays'; days: number }
  | { type: 'workouts'; count: number }
  | { type: 'scoreDays'; minScore: number; days: number }
  | { type: 'completeBefore'; count: number; hour: number }
  | { type: 'allCore' }
  | { type: 'allTiers' }
  | { type: 'metricAtLeast'; metric: MetricType; value: number }
  | { type: 'categoriesTouched'; count: number };

export interface Quest {
  id: ID;
  /** Game date the quest belongs to (start date for weekly/boss quests). */
  date: ISODate;
  /** Inclusive end date for multi-day quests. */
  endDate?: ISODate;
  kind: QuestKind;
  tier: QuestTier;
  activityId?: ID;
  workoutTemplateId?: ID;
  routineId?: ID;
  title: string;
  icon: string;
  category: ActivityCategory;
  description?: string;
  difficulty: Difficulty;
  rarity: Rarity;
  xp: number;
  coins: number;
  energyCost: number;
  stats: StatMap;
  target?: number;
  unit?: string;
  progress: number;
  metric?: MetricType;
  metricMode?: 'atLeast' | 'atMost';
  goal?: QuestGoal;
  durationMin: number;
  scheduledTime?: TimeHM;
  status: QuestStatus;
  snoozedUntil?: Timestamp;
  snoozeCount: number;
  rescheduleCount: number;
  completedAt?: Timestamp;
  /** User-corrected real completion time. Feeds habit learning. */
  actualTime?: TimeHM;
  skipReason?: SkipReason;
  /** Why the generator/adaptive system proposed or changed this quest. */
  reason?: string;
  hidden?: boolean;
  hint?: string;
  /** What completing this quest actually granted (enables undo and history). */
  earned?: { xp: number; coins: number; hp: number; energy: number };
  /** Private quests use discreet text in notifications. */
  private?: boolean;
  /** True when the workload engine demoted the quest to protect the day. */
  lightened?: boolean;
  /** Tier the quest had before balancing (restored when the day is rebalanced). */
  baseTier?: QuestTier;
  /** The player said "Keep this task": balancing never demotes it again. */
  kept?: boolean;
  /** Created by the player through the Coach (never removed when the day is rebuilt). */
  source?: 'coach';
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const DAY_SCOPED_KINDS: QuestKind[] = [
  'scheduled',
  'workout',
  'side',
  'challenge',
  'hidden',
  'manual',
  'first',
];

export const LONG_KINDS: QuestKind[] = ['weekly', 'boss'];
