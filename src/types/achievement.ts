import type { ID, Timestamp } from './common';

export const ACHIEVEMENT_CATEGORIES = [
  'first_steps',
  'training',
  'nutrition',
  'hydration',
  'walking',
  'running',
  'home',
  'pet',
  'routine',
  'consistency',
  'tycoon',
  'level',
  'coins',
  'xp',
  'hidden',
  'long_term',
  'records',
] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/** Serializable unlock condition evaluated against lifetime counters. */
export type Condition =
  | { type: 'counter'; key: string; gte: number }
  | { type: 'all'; of: Condition[] }
  | { type: 'any'; of: Condition[] };

export interface Achievement {
  id: ID;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  tier: AchievementTier;
  hidden: boolean;
  condition: Condition;
  xp: number;
  coins: number;
  unlockedAt?: Timestamp;
  seen?: boolean;
}

export interface PersonalRecord {
  /** e.g. `ex:chest_press:weight`, `steps:day` */
  id: ID;
  kind: 'exercise_weight' | 'exercise_reps' | 'exercise_volume' | 'steps_day' | 'steps_week' | 'streak' | 'score' | 'quests_day';
  label: string;
  value: number;
  unit: string;
  previous?: number;
  date: string;
  refId?: ID;
  updatedAt: Timestamp;
}
