import type { ActivityCategory, StatKey, StatMap } from '@/types';

export interface CategoryInfo {
  label: string;
  icon: string;
  /** Hue-consistent colour used for chips and charts. */
  color: string;
  stats: StatMap;
}

export const CATEGORY_INFO: Record<ActivityCategory, CategoryInfo> = {
  body: { label: 'Body', icon: '🧍', color: '#ff7a59', stats: { health: 1 } },
  fitness: { label: 'Fitness', icon: '🏋️', color: '#ff5a1f', stats: { strength: 2, discipline: 1 } },
  cardio: { label: 'Cardio', icon: '🏃', color: '#ff3b6b', stats: { endurance: 2, health: 1 } },
  nutrition: { label: 'Nutrition', icon: '🥗', color: '#34c759', stats: { health: 2, discipline: 1 } },
  hydration: { label: 'Hydration', icon: '💧', color: '#0ab5ff', stats: { health: 1 } },
  personal_care: { label: 'Personal care', icon: '🪥', color: '#5ac8fa', stats: { care: 1, health: 1 } },
  skincare: { label: 'Skincare', icon: '🧴', color: '#bf8cff', stats: { care: 2 } },
  home: { label: 'Home', icon: '🏠', color: '#ff9f0a', stats: { order: 1, care: 1 } },
  cleaning: { label: 'Cleaning', icon: '🧽', color: '#ffcc00', stats: { order: 2 } },
  order: { label: 'Order', icon: '🗂️', color: '#e5a50a', stats: { order: 2, discipline: 1 } },
  animal_care: { label: 'Animal care', icon: '🐾', color: '#a2845e', stats: { care: 2, consistency: 1 } },
  productivity: { label: 'Productivity', icon: '💼', color: '#5e5ce6', stats: { discipline: 2, knowledge: 1 } },
  reading: { label: 'Reading', icon: '📚', color: '#7c5cff', stats: { knowledge: 2 } },
  online_learning: { label: 'Online learning', icon: '🎓', color: '#6e7dff', stats: { knowledge: 2, discipline: 1 } },
  rest: { label: 'Rest', icon: '🛋️', color: '#64d2ff', stats: { health: 1 } },
  sleep: { label: 'Sleep', icon: '😴', color: '#5856d6', stats: { health: 2, discipline: 1 } },
  social: { label: 'Social', icon: '🫶', color: '#ff6482', stats: { care: 1 } },
  outdoor: { label: 'Outdoor', icon: '🌳', color: '#30d158', stats: { endurance: 1, health: 1 } },
  mental_wellbeing: { label: 'Mental wellbeing', icon: '🧘', color: '#40c8e0', stats: { health: 1, discipline: 1 } },
  general: { label: 'General', icon: '✨', color: '#8e8e93', stats: { discipline: 1 } },
};

export const STAT_INFO: Record<StatKey, { label: string; icon: string; color: string; short: string }> = {
  strength: { label: 'Strength', short: 'STR', icon: '💪', color: '#ff5a1f' },
  endurance: { label: 'Endurance', short: 'END', icon: '🫀', color: '#ff3b6b' },
  discipline: { label: 'Discipline', short: 'DIS', icon: '🎯', color: '#5e5ce6' },
  health: { label: 'Health', short: 'HLT', icon: '🍏', color: '#34c759' },
  order: { label: 'Order', short: 'ORD', icon: '🧹', color: '#ffb020' },
  care: { label: 'Care', short: 'CAR', icon: '🌷', color: '#bf8cff' },
  consistency: { label: 'Consistency', short: 'CON', icon: '🔁', color: '#0ab5ff' },
  knowledge: { label: 'Knowledge', short: 'KNW', icon: '📘', color: '#7c5cff' },
};

export const RARITY_INFO = {
  common: { label: 'Common', color: '#8e8e93' },
  uncommon: { label: 'Uncommon', color: '#30d158' },
  rare: { label: 'Rare', color: '#0a84ff' },
  epic: { label: 'Epic', color: '#bf5af2' },
  legendary: { label: 'Legendary', color: '#ff9f0a' },
} as const;

export const TIER_INFO = {
  core: { label: 'Core', color: '#ff5a1f' },
  important: { label: 'Important', color: '#0a84ff' },
  optional: { label: 'Side', color: '#30d158' },
} as const;
