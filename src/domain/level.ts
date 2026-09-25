import type { LevelRules } from '@/types';

export const MAX_LEVEL = 200;

/** XP required to go from `level` to `level + 1`. Moderately super-linear so high levels slow down. */
export function xpToNext(level: number, rules: LevelRules): number {
  return Math.max(10, Math.round((rules.base * Math.pow(Math.max(1, level), rules.exponent)) / 10) * 10);
}

/** Cumulative XP needed to reach `level` (level 1 = 0). */
export function totalXpForLevel(level: number, rules: LevelRules): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l, rules);
  return total;
}

export interface LevelProgress {
  level: number;
  /** XP accumulated inside the current level. */
  into: number;
  /** XP the current level requires in total. */
  needed: number;
  progress: number;
}

export function levelFromXp(xp: number, rules: LevelRules): LevelProgress {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (level < MAX_LEVEL) {
    const need = xpToNext(level, rules);
    if (remaining < need) return { level, into: remaining, needed: need, progress: remaining / need };
    remaining -= need;
    level++;
  }
  return { level: MAX_LEVEL, into: 0, needed: 1, progress: 1 };
}

/** Levels gained when moving from `prevXp` to `nextXp`. */
export function levelsGained(prevXp: number, nextXp: number, rules: LevelRules): number[] {
  const from = levelFromXp(prevXp, rules).level;
  const to = levelFromXp(nextXp, rules).level;
  const out: number[] = [];
  for (let l = from + 1; l <= to; l++) out.push(l);
  return out;
}

export type LevelPerk =
  | { type: 'coins'; amount: number }
  | { type: 'item'; item: 'streakFreeze' | 'streakRevive' | 'reroll'; amount: number }
  | { type: 'feature'; label: string };

/** Rewards granted on reaching a level. Something every level, bigger ones at milestones. */
export function levelPerks(level: number): LevelPerk[] {
  const perks: LevelPerk[] = [{ type: 'coins', amount: 20 + level * 5 }];
  if (level % 5 === 0) perks.push({ type: 'item', item: 'streakFreeze', amount: 1 });
  if (level % 10 === 0) perks.push({ type: 'item', item: 'streakRevive', amount: 1 });
  if (level % 3 === 0) perks.push({ type: 'item', item: 'reroll', amount: 1 });
  const features: Record<number, string> = {
    2: 'Side quests unlocked',
    3: 'Daily Challenge unlocked',
    4: 'Hidden quests unlocked',
    5: 'Weekly quests unlocked',
    8: 'Boss quests unlocked',
  };
  if (features[level]) perks.push({ type: 'feature', label: features[level] });
  return perks;
}

/** Feature gates tied to level so the first days are not overwhelming. */
export const FEATURE_LEVELS = {
  sideQuests: 2,
  challenge: 3,
  hidden: 4,
  weekly: 5,
  boss: 8,
} as const;
