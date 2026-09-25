import type { ID, ISODate, StatKey, Timestamp } from './common';

export interface StreakState {
  current: number;
  longest: number;
  lastSuccessDate?: ISODate;
  /** Streak value right before the last break — what a revive can restore. */
  brokenValue?: number;
  brokenAt?: ISODate;
  frozenDates: ISODate[];
  weekly: {
    current: number;
    longest: number;
    lastWeekKey?: string;
  };
}

export interface Inventory {
  streakFreeze: number;
  streakRevive: number;
  reroll: number;
}

export interface ActiveBoost {
  id: ID;
  type: 'xp' | 'coins';
  multiplier: number;
  expiresAt: Timestamp;
  source: string;
}

export type StatusEffectKind = 'sluggish' | 'focused' | 'comeback' | 'procrastinator' | 'rested';

export interface StatusEffect {
  id: ID;
  kind: StatusEffectKind;
  label: string;
  description: string;
  icon: string;
  xpMultiplier?: number;
  coinMultiplier?: number;
  /** Inclusive last game date on which the effect applies. */
  expiresOn: ISODate;
}

export interface AvatarConfig {
  skin: string;
  hairStyle: string;
  hairColor: string;
  outfit: string;
  outfitColor: string;
  accessory: string;
  background: string;
}

export interface Player {
  id: 'me';
  name: string;
  level: number;
  /** Lifetime XP (level is derived from it). */
  xp: number;
  coins: number;
  hp: number;
  energy: number;
  maxEnergy: number;
  stats: Record<StatKey, number>;
  streak: StreakState;
  inventory: Inventory;
  boosts: ActiveBoost[];
  effects: StatusEffect[];
  avatar: AvatarConfig;
  recoveryMode: boolean;
  recoveryStartedOn?: ISODate;
  lifetime: {
    xpEarned: number;
    coinsEarned: number;
    coinsSpent: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CharacterClass {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface ClassAffinity {
  classId: string;
  affinity: number;
}
