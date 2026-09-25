import type { ActivityCategory, Building } from '@/types';
import { roundTo } from '@/utils/math';

/** Cost to reach `targetLevel` (moderate exponential, rounded to friendly numbers). */
export function buildingCost(b: Pick<Building, 'baseCost' | 'costGrowth'>, targetLevel: number): number {
  const raw = b.baseCost * Math.pow(b.costGrowth, Math.max(0, targetLevel - 1));
  const step = raw >= 10000 ? 500 : raw >= 1000 ? 100 : raw >= 200 ? 50 : 10;
  return roundTo(raw, step);
}

export type BuildBlocker =
  | { type: 'maxLevel' }
  | { type: 'playerLevel'; required: number }
  | { type: 'requires'; buildingId: string; name: string; level: number }
  | { type: 'coins'; missing: number };

export function buildBlockers(
  b: Building,
  playerLevel: number,
  coins: number,
  all: Building[],
): BuildBlocker[] {
  const out: BuildBlocker[] = [];
  if (b.level >= b.maxLevel) return [{ type: 'maxLevel' }];
  const nextLevel = b.level + 1;
  const required = b.unlockLevel + (nextLevel - 1) * 3;
  if (playerLevel < required) out.push({ type: 'playerLevel', required });
  for (const r of b.requires) {
    const dep = all.find((x) => x.id === r.buildingId);
    if (!dep || dep.level < r.level) out.push({ type: 'requires', buildingId: r.buildingId, name: dep?.name ?? r.buildingId, level: r.level });
  }
  const cost = buildingCost(b, nextLevel);
  if (coins < cost) out.push({ type: 'coins', missing: cost - coins });
  return out;
}

export interface WorldBonuses {
  xpPctByCategory: Partial<Record<ActivityCategory, number>>;
  coinPctByCategory: Partial<Record<ActivityCategory, number>>;
  dailyIncome: number;
  maxEnergy: number;
  hpRegen: number;
  sideQuestSlots: number;
  unlockedCategories: Set<ActivityCategory>;
}

/** Aggregate gameplay bonuses from every built room. */
export function worldBonuses(buildings: Building[]): WorldBonuses {
  const out: WorldBonuses = {
    xpPctByCategory: {},
    coinPctByCategory: {},
    dailyIncome: 0,
    maxEnergy: 0,
    hpRegen: 0,
    sideQuestSlots: 0,
    unlockedCategories: new Set(),
  };
  for (const b of buildings) {
    if (b.level <= 0) continue;
    for (const e of b.effects) {
      switch (e.type) {
        case 'categoryXpPct':
          for (const c of e.categories) out.xpPctByCategory[c] = (out.xpPctByCategory[c] ?? 0) + e.pctPerLevel * b.level;
          break;
        case 'categoryCoinPct':
          for (const c of e.categories) out.coinPctByCategory[c] = (out.coinPctByCategory[c] ?? 0) + e.pctPerLevel * b.level;
          break;
        case 'dailyIncome':
          out.dailyIncome += e.perLevel * b.level;
          break;
        case 'maxEnergy':
          out.maxEnergy += e.perLevel * b.level;
          break;
        case 'hpRegen':
          out.hpRegen += e.perLevel * b.level;
          break;
        case 'sideQuestSlots':
          out.sideQuestSlots += Math.floor(e.perLevel * b.level);
          break;
        case 'unlockCategories':
          for (const c of e.categories) out.unlockedCategories.add(c);
          break;
      }
    }
  }
  return out;
}

/** World income is earned only by playing: scaled by yesterday's score. */
export function worldIncome(dailyIncome: number, score: number): number {
  if (score < 30) return 0;
  return Math.round(dailyIncome * (score / 100));
}

export function homeLevel(buildings: Building[]): number {
  return buildings.reduce((s, b) => s + b.level, 0);
}

const HOME_TITLES: [number, string][] = [
  [0, 'Empty Lot'],
  [1, 'Tiny Room'],
  [3, 'Studio'],
  [6, 'Apartment'],
  [10, 'Town House'],
  [16, 'Family House'],
  [24, 'Villa'],
  [34, 'Estate'],
  [46, 'Forge Tower'],
];

export function homeTitle(level: number): string {
  let title = HOME_TITLES[0][1];
  for (const [min, t] of HOME_TITLES) if (level >= min) title = t;
  return title;
}

export function nextHomeTitle(level: number): { title: string; at: number } | undefined {
  const next = HOME_TITLES.find(([min]) => min > level);
  return next ? { title: next[1], at: next[0] } : undefined;
}

/** Furniture visible at the current level (cumulative). */
export function visibleFurniture(b: Building): string[] {
  return b.furniture.slice(0, Math.max(0, b.level)).flat();
}
