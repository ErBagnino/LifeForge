import type { ActivityCategory } from '@/types';

/**
 * Perks: every PERK_EVERY player levels you may pick one small perk. They are modest XP
 * bonuses in an area you care about — no "optimal build": picks can be changed any time,
 * for free, and every perk is worth the same.
 */

export const PERK_EVERY = 5;
export const PERK_XP_PCT = 8;

export interface PerkDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  categories?: ActivityCategory[];
  /** Applies before this local hour instead of by category. */
  beforeHour?: number;
  xpPct: number;
}

export const PERKS: PerkDef[] = [
  { id: 'morning_momentum', name: 'Morning Momentum', icon: '🌅', description: '+10% XP for anything done before 10:00.', beforeHour: 10, xpPct: 10 },
  { id: 'training_focus', name: 'Training Focus', icon: '🏋️', description: `+${PERK_XP_PCT}% XP on fitness and cardio.`, categories: ['fitness', 'cardio', 'body', 'outdoor'], xpPct: PERK_XP_PCT },
  { id: 'hydration_bonus', name: 'Well Fed', icon: '🥗', description: `+${PERK_XP_PCT}% XP on nutrition and hydration.`, categories: ['nutrition', 'hydration'], xpPct: PERK_XP_PCT },
  { id: 'knowledge_bonus', name: 'Curious Mind', icon: '📚', description: `+${PERK_XP_PCT}% XP on reading, learning and focused work.`, categories: ['reading', 'online_learning', 'productivity'], xpPct: PERK_XP_PCT },
  { id: 'recovery_specialist', name: 'Recovery Specialist', icon: '😴', description: `+${PERK_XP_PCT}% XP on sleep, rest and mental wellbeing.`, categories: ['sleep', 'rest', 'mental_wellbeing'], xpPct: PERK_XP_PCT },
  { id: 'home_keeper', name: 'Home Keeper', icon: '🏠', description: `+${PERK_XP_PCT}% XP on home, cleaning, order and pet care.`, categories: ['home', 'cleaning', 'order', 'animal_care'], xpPct: PERK_XP_PCT },
  { id: 'self_care', name: 'Glow Up', icon: '🧴', description: `+${PERK_XP_PCT}% XP on personal care, skincare and social time.`, categories: ['personal_care', 'skincare', 'social'], xpPct: PERK_XP_PCT },
];

export function perkSlots(level: number): number {
  return Math.floor(level / PERK_EVERY);
}

/** Only known, distinct perks, capped at the slots the level allows. */
export function validPicks(picks: string[], level: number): string[] {
  const seen = new Set<string>();
  return picks.filter((id) => PERKS.some((p) => p.id === id) && !seen.has(id) && seen.add(id)).slice(0, perkSlots(level));
}

/** Total perk XP % for a completion in `category` at local `hour`. */
export function perkXpPct(picks: string[], level: number, category: ActivityCategory, hour: number): number {
  return validPicks(picks, level).reduce((sum, id) => {
    const p = PERKS.find((x) => x.id === id)!;
    const hit = p.beforeHour !== undefined ? hour < p.beforeHour : !!p.categories?.includes(category);
    return sum + (hit ? p.xpPct : 0);
  }, 0);
}

/** Momentum XP bonus for the resulting combo length (2 → +5%, 3+ → +10%). Never negative. */
export function momentumXpPct(comboAfter: number): number {
  return comboAfter >= 3 ? 10 : comboAfter === 2 ? 5 : 0;
}
