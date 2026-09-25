/** Opaque identifier. */
export type ID = string;
/** Game date in `yyyy-MM-dd` form (respects the configurable day-start hour). */
export type ISODate = string;
/** Wall-clock time in `HH:mm` form. */
export type TimeHM = string;
/** Milliseconds since epoch. */
export type Timestamp = number;

export const STAT_KEYS = [
  'strength',
  'endurance',
  'discipline',
  'health',
  'order',
  'care',
  'consistency',
  'knowledge',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatMap = Partial<Record<StatKey, number>>;

export const CATEGORIES = [
  'body',
  'fitness',
  'cardio',
  'nutrition',
  'hydration',
  'personal_care',
  'skincare',
  'home',
  'cleaning',
  'order',
  'animal_care',
  'productivity',
  'reading',
  'online_learning',
  'rest',
  'sleep',
  'social',
  'outdoor',
  'mental_wellbeing',
  'general',
] as const;
export type ActivityCategory = (typeof CATEGORIES)[number];

export const QUEST_TIERS = ['core', 'important', 'optional'] as const;
export type QuestTier = (typeof QUEST_TIERS)[number];

/** 1 trivial · 2 easy · 3 medium · 4 hard · 5 boss */
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export const DIFFICULTIES: Difficulty[] = [1, 2, 3, 4, 5];

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export const GAME_DIFFICULTIES = ['casual', 'normal', 'hard', 'insane'] as const;
export type GameDifficulty = (typeof GAME_DIFFICULTIES)[number];

export type DifficultyState = 'too_easy' | 'balanced' | 'overloaded' | 'critical';
export type WorkloadLevel = 'low' | 'medium' | 'high';
export type DayType = 'work' | 'free' | 'rest';
export type TimeOfDay = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | 'anytime';

export const METRIC_TYPES = [
  'steps',
  'water',
  'weight',
  'sleep',
  'calories',
  'protein',
  'carbs',
  'fat',
  'distance',
  'activeCalories',
  'workoutMinutes',
  /** Leisure screen time (games, short videos…) in minutes. */
  'leisure',
] as const;
export type MetricType = (typeof METRIC_TYPES)[number];
export type MetricMap = Partial<Record<MetricType, number>>;

export interface TimeBlock {
  start: TimeHM;
  end: TimeHM;
  label?: string;
}

export type Importance = 1 | 2 | 3 | 4 | 5;
