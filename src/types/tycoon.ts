import type { ActivityCategory, ID, StatKey, Timestamp } from './common';

export type BuildingEffect =
  | { type: 'categoryXpPct'; categories: ActivityCategory[]; pctPerLevel: number }
  | { type: 'categoryCoinPct'; categories: ActivityCategory[]; pctPerLevel: number }
  | { type: 'dailyIncome'; perLevel: number }
  | { type: 'maxEnergy'; perLevel: number }
  | { type: 'hpRegen'; perLevel: number }
  | { type: 'sideQuestSlots'; perLevel: number }
  | { type: 'unlockCategories'; categories: ActivityCategory[] };

export interface BuildingPalette {
  wall: string;
  floor: string;
  accent: string;
}

export interface Building {
  id: ID;
  name: string;
  icon: string;
  description: string;
  /** Life area the room represents. */
  lifeArea: string;
  stats: StatKey[];
  categories: ActivityCategory[];
  /** Cutaway position: floor index from the ground (0) upwards, negative = basement. */
  floor: number;
  slot: 'left' | 'right' | 'full';
  maxLevel: number;
  /** Cost to build level 1. Level n costs baseCost × growth^(n-1). */
  baseCost: number;
  costGrowth: number;
  unlockLevel: number;
  requires: { buildingId: ID; level: number }[];
  effects: BuildingEffect[];
  palette: BuildingPalette;
  /** Furniture emoji shown per level (index 0 = level 1). Cumulative. */
  furniture: string[][];
  /** Current state */
  level: number;
  builtAt?: Timestamp;
  upgradedAt?: Timestamp;
}

export type CosmeticType =
  | 'hair'
  | 'hairColor'
  | 'outfit'
  | 'outfitColor'
  | 'accessory'
  | 'skin'
  | 'background'
  | 'theme'
  | 'decoration';

export interface Cosmetic {
  id: ID;
  name: string;
  type: CosmeticType;
  icon: string;
  /** Style key or colour value, depending on type. */
  value: string;
  price: number;
  unlockLevel?: number;
  unlockAchievement?: ID;
  /** Decorations are placed in a room. */
  room?: ID;
  owned: boolean;
  equipped: boolean;
  acquiredAt?: Timestamp;
}

export type ShopItemId = 'streakFreeze' | 'streakRevive' | 'reroll' | 'xpBoost' | 'coinBoost';

export interface ShopItem {
  id: ShopItemId;
  name: string;
  icon: string;
  description: string;
  price: number;
  /** Max owned (or max active for boosts). */
  maxStack: number;
}

export type RewardKind = 'money' | 'leisure' | 'food' | 'item' | 'experience' | 'other';

/** A real-world reward defined and approved by the user. */
export interface RealReward {
  id: ID;
  name: string;
  icon: string;
  description?: string;
  kind: RewardKind;
  cost: number;
  approved: boolean;
  cooldownDays: number;
  redeemedCount: number;
  lastRedeemedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface RewardRedemption {
  id: ID;
  rewardId: ID;
  name: string;
  cost: number;
  ts: Timestamp;
}
