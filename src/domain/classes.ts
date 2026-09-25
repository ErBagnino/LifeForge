import type { ActivityCategory, CharacterClass, ClassAffinity, StatKey, StatMap } from '@/types';

export const CLASSES: CharacterClass[] = [
  { id: 'athlete', name: 'Athlete', icon: '🏋️', description: 'Strength and endurance lead the way. The gym knows your name.' },
  { id: 'builder', name: 'Builder', icon: '🧱', description: 'Order, home and world-building. You make places better.' },
  { id: 'disciplined', name: 'Disciplined', icon: '🎯', description: 'Core quests done, streaks alive. Reliability is your superpower.' },
  { id: 'explorer', name: 'Explorer', icon: '🧭', description: 'Outdoors, variety, new things. You rarely do the same day twice.' },
  { id: 'guardian', name: 'Guardian', icon: '🛡️', description: 'Care for yourself, your space and your companions.' },
  { id: 'creator', name: 'Creator', icon: '💡', description: 'Knowledge and productivity. Always building something in your head.' },
  { id: 'survivor', name: 'Survivor', icon: '🔥', description: 'Knocked down, got back up. Comebacks are your trademark.' },
  { id: 'balanced', name: 'Balanced', icon: '☯️', description: 'No weak spot. A bit of everything, done well.' },
];

export interface ClassInput {
  /** Stat points earned in the recent window. */
  stats: StatMap;
  categoryCounts: Partial<Record<ActivityCategory, number>>;
  coreRate: number;
  streak: number;
  recoveryDays: number;
  worldSpend: number;
}

/**
 * The class emerges from behaviour over the recent window — never picked manually.
 * Returns affinities (sum = 1) sorted high → low.
 */
export function computeClassAffinities(input: ClassInput): ClassAffinity[] {
  const s = (k: StatKey) => input.stats[k] ?? 0;
  const total = Object.values(input.stats).reduce((a, b) => a + (b ?? 0), 0);
  if (total <= 0) return [{ classId: 'balanced', affinity: 1 }];
  const share = (k: StatKey) => s(k) / total;
  const cats = input.categoryCounts;
  const catTotal = Object.values(cats).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const variety = Object.values(cats).filter((v) => (v ?? 0) > 0).length;

  const shares = Object.values(input.stats).map((v) => (v ?? 0) / total);
  const evenness = 1 - (Math.max(...shares) - Math.min(...shares));

  const raw: Record<string, number> = {
    athlete: share('strength') * 1.4 + share('endurance') * 1.1,
    builder: share('order') * 1.4 + Math.min(0.4, input.worldSpend / 20000),
    disciplined: share('discipline') * 0.8 + share('consistency') * 1.2 + input.coreRate * 0.35 + Math.min(0.25, input.streak / 120),
    explorer: ((cats.outdoor ?? 0) + (cats.cardio ?? 0) * 0.5) / catTotal + Math.min(0.35, variety / 45),
    guardian: share('care') * 1.3 + share('health') * 0.5,
    creator: share('knowledge') * 1.5 + ((cats.productivity ?? 0) / catTotal) * 0.6,
    survivor: Math.min(0.9, input.recoveryDays * 0.12),
    balanced: evenness * 0.55,
  };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(raw)
    .map(([classId, v]) => ({ classId, affinity: v / sum }))
    .sort((a, b) => b.affinity - a.affinity);
}

export function classById(id: string): CharacterClass {
  return CLASSES.find((c) => c.id === id) ?? CLASSES[CLASSES.length - 1];
}

/** Stat level from accumulated stat points (slow, readable numbers). */
export function statLevel(points: number): { level: number; progress: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, points) / 5)) + 1;
  const cur = 5 * (level - 1) ** 2;
  const next = 5 * level ** 2;
  return { level, progress: (points - cur) / (next - cur) };
}
