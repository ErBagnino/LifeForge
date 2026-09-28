import type { ActivityCategory, ISODate, Quest } from '@/types';
import { shiftDate } from '@/utils/date';

/**
 * Mastery: ten long-term tracks grown from completed quests. Each extra completion in the
 * same track on the same game day is worth less (diminishing returns), so mastery rewards
 * showing up across many days rather than grinding one afternoon. Derived from real quest
 * history only — nothing is stored, so it can never drift from what actually happened.
 */

export const MASTERY_TRACKS = [
  { id: 'strength', label: 'Strength', icon: '🏋️', color: '#ff5a1f', categories: ['fitness', 'body'] },
  { id: 'endurance', label: 'Endurance', icon: '🏃', color: '#ff3b6b', categories: ['cardio', 'outdoor'] },
  { id: 'nutrition', label: 'Nutrition', icon: '🥗', color: '#34c759', categories: ['nutrition'] },
  { id: 'hydration', label: 'Hydration', icon: '💧', color: '#0ab5ff', categories: ['hydration'] },
  { id: 'care', label: 'Self-care', icon: '🧴', color: '#bf8cff', categories: ['personal_care', 'skincare'] },
  { id: 'home', label: 'Home', icon: '🏠', color: '#ff9f0a', categories: ['home', 'cleaning', 'order'] },
  { id: 'pet', label: 'Companion', icon: '🐾', color: '#a2845e', categories: ['animal_care'] },
  { id: 'mind', label: 'Mind', icon: '📚', color: '#7c5cff', categories: ['reading', 'online_learning', 'productivity'] },
  { id: 'recovery', label: 'Recovery', icon: '😴', color: '#5856d6', categories: ['rest', 'sleep', 'mental_wellbeing'] },
  { id: 'social', label: 'Connection', icon: '🫶', color: '#ff6482', categories: ['social'] },
] as const satisfies readonly { id: string; label: string; icon: string; color: string; categories: readonly ActivityCategory[] }[];

export type MasteryTrackId = (typeof MASTERY_TRACKS)[number]['id'];

export const MASTERY_MAX_LEVEL = 20;
/** Weight of the 1st, 2nd, 3rd… completion in one track on one day; later ones use the last value. */
export const DAILY_WEIGHTS = [1, 0.6, 0.35, 0.2, 0.1];
/** A perk (an equippable title) unlocks every PERK_EVERY levels. */
export const PERK_EVERY = 5;

export function trackOf(category: ActivityCategory): MasteryTrackId | undefined {
  return MASTERY_TRACKS.find((t) => (t.categories as readonly ActivityCategory[]).includes(category))?.id;
}

/** Cumulative points needed to reach `level` (level 1 = 10 points, level 2 = 30, level 3 = 60…). */
export function pointsForLevel(level: number): number {
  return 5 * level * (level + 1);
}

export function masteryLevel(points: number): { level: number; into: number; needed: number; progress: number } {
  let level = 0;
  while (level < MASTERY_MAX_LEVEL && points >= pointsForLevel(level + 1)) level++;
  if (level >= MASTERY_MAX_LEVEL) return { level, into: 0, needed: 0, progress: 1 };
  const base = pointsForLevel(level);
  const needed = pointsForLevel(level + 1) - base;
  return { level, into: points - base, needed, progress: (points - base) / needed };
}

export interface Perk {
  id: string;
  track: MasteryTrackId;
  level: number;
  title: string;
}

const PERK_TITLES: Record<MasteryTrackId, [string, string, string, string]> = {
  strength: ['Iron Novice', 'Iron Adept', 'Iron Master', 'Iron Legend'],
  endurance: ['Trail Walker', 'Long Strider', 'Marathon Mind', 'Endless Runner'],
  nutrition: ['Mindful Eater', 'Kitchen Adept', 'Nutrition Sage', 'Fuel Master'],
  hydration: ['Water Friend', 'Spring Keeper', 'River Soul', 'Ocean Heart'],
  care: ['Self-Care Starter', 'Gentle Routine', 'Care Adept', 'Radiant'],
  home: ['Tidy Starter', 'Home Keeper', 'Order Adept', 'Castle Steward'],
  pet: ['Pet Pal', 'Loyal Keeper', 'Beast Friend', 'Pack Leader'],
  mind: ['Curious Mind', 'Scholar', 'Sage', 'Archmage'],
  recovery: ['Rested', 'Calm Keeper', 'Recovery Adept', 'Zen Master'],
  social: ['Friendly Face', 'Good Company', 'Heart of the Group', 'Kindred Spirit'],
};

export function perksFor(track: MasteryTrackId): Perk[] {
  return PERK_TITLES[track].map((title, i) => ({ id: `${track}:${(i + 1) * PERK_EVERY}`, track, level: (i + 1) * PERK_EVERY, title }));
}

export function perkById(id: string): Perk | undefined {
  const [track] = id.split(':');
  return MASTERY_TRACKS.some((t) => t.id === track) ? perksFor(track as MasteryTrackId).find((p) => p.id === id) : undefined;
}

export interface TrackMastery {
  id: MasteryTrackId;
  label: string;
  icon: string;
  color: string;
  points: number;
  completions: number;
  activeDays: number;
  level: number;
  into: number;
  needed: number;
  progress: number;
  /** Points earned in the last 7 days (up to `today`). */
  recent: number;
  lastDate?: ISODate;
  perks: (Perk & { unlocked: boolean })[];
}

type MasteryQuest = Pick<Quest, 'category' | 'status' | 'date' | 'hidden'>;

/** Mastery of every track from completed quests (any order). */
export function computeMastery(quests: MasteryQuest[], today: ISODate): TrackMastery[] {
  const perDay = new Map<string, number>(); // track|date → completions so far
  const acc = new Map<MasteryTrackId, { points: number; completions: number; days: Set<string>; recent: number; last?: ISODate }>();
  const weekAgo = shiftDate(today, -6);
  const sorted = quests.filter((q) => q.status === 'completed' && !q.hidden).sort((a, b) => a.date.localeCompare(b.date));
  for (const q of sorted) {
    const track = trackOf(q.category);
    if (!track) continue;
    const key = `${track}|${q.date}`;
    const n = perDay.get(key) ?? 0;
    perDay.set(key, n + 1);
    const w = DAILY_WEIGHTS[Math.min(n, DAILY_WEIGHTS.length - 1)];
    const a = acc.get(track) ?? { points: 0, completions: 0, days: new Set<string>(), recent: 0 };
    a.points += w;
    a.completions++;
    a.days.add(q.date);
    if (q.date >= weekAgo && q.date <= today) a.recent += w;
    if (!a.last || q.date > a.last) a.last = q.date;
    acc.set(track, a);
  }
  return MASTERY_TRACKS.map((t) => {
    const a = acc.get(t.id);
    const points = round2(a?.points ?? 0);
    const lv = masteryLevel(points);
    return {
      id: t.id,
      label: t.label,
      icon: t.icon,
      color: t.color,
      points,
      completions: a?.completions ?? 0,
      activeDays: a?.days.size ?? 0,
      ...lv,
      recent: round2(a?.recent ?? 0),
      lastDate: a?.last,
      perks: perksFor(t.id).map((p) => ({ ...p, unlocked: lv.level >= p.level })),
    };
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

