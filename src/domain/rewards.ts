import type {
  ActiveBoost,
  ActivityCategory,
  Difficulty,
  DifficultyPreset,
  EnergyRules,
  GameRules,
  Importance,
  Rarity,
  Recurrence,
  StatusEffect,
  XpRules,
} from '@/types';
import { clamp, roundTo } from '@/utils/math';

export interface QuestValueInput {
  difficulty: Difficulty;
  durationMin: number;
  importance: Importance;
  recurrence?: Recurrence;
  rarity: Rarity;
  category?: ActivityCategory;
  baseXp?: number;
  baseCoins?: number;
  energyCost?: number;
}

export interface QuestValues {
  xp: number;
  coins: number;
  energyCost: number;
}

/** Rarer habits are worth a bit more per completion than daily ones. */
export function frequencyFactor(recurrence?: Recurrence): number {
  if (!recurrence) return 1;
  switch (recurrence.type) {
    case 'daily':
      return 1;
    case 'weekdays':
      return 1 + ((7 - Math.min(7, recurrence.days.length)) / 7) * 0.2;
    case 'timesPerWeek':
      return 1 + ((7 - Math.min(7, recurrence.times)) / 7) * 0.3;
    case 'everyNDays':
      return 1 + Math.min(0.3, recurrence.n * 0.04);
    case 'pool':
      return 1.05;
  }
}

export function levelFactor(level: number, rules: XpRules): number {
  return 1 + Math.min(Math.max(0, level - 1), rules.levelScalingMaxLevels) * rules.levelScalingPerLevel;
}

const RECOVERY_CATEGORIES: ActivityCategory[] = ['rest', 'sleep', 'mental_wellbeing'];

export function isRecoveryCategory(category: ActivityCategory): boolean {
  return RECOVERY_CATEGORIES.includes(category);
}

/** Energy cost from difficulty and duration. Recovery activities restore energy instead. */
export function computeEnergyCost(
  difficulty: Difficulty,
  durationMin: number,
  rules: EnergyRules,
  category?: ActivityCategory,
): number {
  const base = rules.costByDifficulty[difficulty];
  const extra = Math.max(0, Math.round((durationMin - 20) / 10));
  const cost = base + extra;
  if (category && isRecoveryCategory(category)) return -Math.max(3, Math.round(cost * 0.8));
  return cost;
}

/**
 * Base XP for a quest (before completion-time multipliers).
 * Depends on difficulty, duration, importance, frequency, estimated effort, rarity and player level.
 */
export function computeBaseXp(input: QuestValueInput, level: number, rules: XpRules, energyCost: number): number {
  const base = input.baseXp ?? rules.baseByDifficulty[input.difficulty];
  const ref = rules.refDurationByDifficulty[input.difficulty];
  const durationFactor = input.baseXp
    ? 1
    : 1 + clamp((input.durationMin - ref) / 60, -0.3, 0.5);
  const importanceFactor = 0.9 + input.importance * 0.04;
  const effortFactor = 1 + clamp(energyCost, 0, 40) / 200;
  const raw =
    base *
    durationFactor *
    importanceFactor *
    frequencyFactor(input.recurrence) *
    effortFactor *
    rules.rarityMultiplier[input.rarity] *
    levelFactor(level, rules);
  return Math.max(5, roundTo(raw, 5));
}

export function computeQuestValues(input: QuestValueInput, level: number, rules: GameRules): QuestValues {
  const energyCost =
    input.energyCost ?? computeEnergyCost(input.difficulty, input.durationMin, rules.energy, input.category);
  const xp = computeBaseXp(input, level, rules.xp, energyCost);
  const coins =
    input.baseCoins !== undefined
      ? Math.round(input.baseCoins * rules.xp.rarityMultiplier[input.rarity])
      : Math.max(1, Math.round(xp * rules.coins.ratio));
  return { xp, coins, energyCost };
}

export interface Multiplier {
  label: string;
  value: number;
  applies: 'xp' | 'coins' | 'both';
}

export interface MultiplierContext {
  now: number;
  date: string;
  streak: number;
  preset: DifficultyPreset;
  boosts: ActiveBoost[];
  effects: StatusEffect[];
  categoryXpPct: number;
  categoryCoinPct: number;
  recoveryMode: boolean;
}

/** Every completion-time multiplier, labelled so the UI can explain the numbers. */
export function rewardMultipliers(ctx: MultiplierContext, rules: XpRules): Multiplier[] {
  const out: Multiplier[] = [];
  if (ctx.preset.rewardMultiplier !== 1) {
    out.push({ label: 'Difficulty', value: ctx.preset.rewardMultiplier, applies: 'both' });
  }
  const streakBonus = Math.min(rules.streakBonusMax, ctx.streak * rules.streakBonusPerDay);
  if (streakBonus > 0) out.push({ label: `Streak ×${ctx.streak}`, value: 1 + streakBonus, applies: 'xp' });
  if (ctx.categoryXpPct > 0) out.push({ label: 'World bonus', value: 1 + ctx.categoryXpPct / 100, applies: 'xp' });
  if (ctx.categoryCoinPct > 0) {
    out.push({ label: 'World bonus', value: 1 + ctx.categoryCoinPct / 100, applies: 'coins' });
  }
  for (const b of ctx.boosts) {
    if (b.expiresAt > ctx.now) {
      out.push({ label: b.type === 'xp' ? 'XP boost' : 'Coin boost', value: b.multiplier, applies: b.type });
    }
  }
  for (const e of ctx.effects) {
    if (e.expiresOn < ctx.date) continue;
    if (e.xpMultiplier && e.xpMultiplier !== 1) out.push({ label: e.label, value: e.xpMultiplier, applies: 'xp' });
    if (e.coinMultiplier && e.coinMultiplier !== 1) {
      out.push({ label: e.label, value: e.coinMultiplier, applies: 'coins' });
    }
  }
  if (ctx.recoveryMode) out.push({ label: 'Comeback', value: 1.15, applies: 'xp' });
  return out;
}

export function applyMultipliers(
  base: { xp: number; coins: number },
  multipliers: Multiplier[],
): { xp: number; coins: number } {
  let xp = base.xp;
  let coins = base.coins;
  for (const m of multipliers) {
    if (m.applies !== 'coins') xp *= m.value;
    if (m.applies !== 'xp') coins *= m.value;
  }
  return { xp: Math.max(0, Math.round(xp)), coins: Math.max(0, Math.round(coins)) };
}

/** XP range labels from the spec, useful for admin previews. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: 'Trivial',
  2: 'Easy',
  3: 'Medium',
  4: 'Hard',
  5: 'Boss',
};
