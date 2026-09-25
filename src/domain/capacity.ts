import type { ISODate, LoadMode, QuestTier, WorkloadLevel } from '@/types';
import { clamp, median } from '@/utils/math';
import { TRIVIAL_MINUTES } from './adaptive';

/**
 * Daily Capacity: how many minutes of quests fit into *this* day for *this* player.
 * It starts from what we know (work, busy blocks, wake/sleep) and learns from what
 * actually got done on similar days, so it adapts instead of being a fixed formula.
 */

export type DayKind = 'work' | 'free' | 'unknown' | 'rest';

export interface CapacitySample {
  date: ISODate;
  kind: DayKind;
  /** Core + important minutes planned that day. */
  plannedMin: number;
  /** Minutes of quests actually completed. */
  completedMin: number;
  /** Free time (awake − work − busy) when work was known. */
  freeMin?: number;
}

export interface CapacityInput {
  kind: DayKind;
  awakeMin: number;
  /** Net work minutes; undefined when unknown (never assumed). */
  workMin?: number;
  busyMin: number;
  energy: number;
  maxEnergy: number;
  /** Closed past days, newest first. */
  history: CapacitySample[];
  /** Product of "more / less time" periods (1 = none). */
  adjustment: number;
  /** Days since the adventure started (0 = day 1). */
  dayIndex: number;
}

export interface CapacityResult {
  minutes: number;
  freeMin?: number;
  /** Share of free time the player really spends on quests (learned or default). */
  fraction: number;
  /** Minutes usually completed on similar days, when there is enough history. */
  learnedMin?: number;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
}

/** Share of free time spent on tracked quests before we have data. */
export const DEFAULT_FRACTION = 0.35;
/** Capacity for days whose work hours are unknown, before we have data. */
export const DEFAULT_UNKNOWN_MIN = 120;
const MIN_CAPACITY = 20;
const MAX_CAPACITY = 600;

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${String(m).padStart(2, '0')}m` : ''}` : `${m} min`;
}

export function computeCapacity(input: CapacityInput): CapacityResult {
  const reasons: string[] = [];
  const recent = input.history.slice(0, 21).filter((s) => s.kind !== 'rest' && s.plannedMin > 0);
  const similar = recent.filter((s) => s.kind === input.kind);

  const freeMin =
    input.kind === 'work' && input.workMin !== undefined
      ? Math.max(0, input.awakeMin - input.workMin - input.busyMin)
      : input.kind === 'free' || input.kind === 'rest'
        ? Math.max(0, input.awakeMin - input.busyMin)
        : undefined;

  // Learned share of free time actually used (headroom so the target can grow).
  const ratios = recent.filter((s) => s.freeMin && s.freeMin > 60).map((s) => s.completedMin / s.freeMin!);
  const learnedFraction = ratios.length >= 3 ? clamp(median(ratios) * 1.15, 0.15, 0.7) : undefined;
  const fraction = learnedFraction ?? DEFAULT_FRACTION;

  // Learned absolute minutes on similar days.
  const pool = similar.length >= 3 ? similar : recent.length >= 5 ? recent : [];
  const learnedMin = pool.length ? median(pool.map((s) => s.completedMin)) * 1.15 : undefined;

  let minutes: number;
  if (freeMin !== undefined) {
    const fromFree = freeMin * fraction;
    minutes = learnedMin !== undefined && similar.length >= 3 ? fromFree * 0.6 + learnedMin * 0.4 : fromFree;
    if (input.kind === 'work') reasons.push(`Work ${fmt(input.workMin!)} · ${fmt(freeMin)} free`);
    else reasons.push(`${fmt(freeMin)} awake and free`);
  } else {
    minutes = learnedMin ?? DEFAULT_UNKNOWN_MIN;
    reasons.push(learnedMin !== undefined ? `Work hours not set · based on your recent days` : 'Work hours not set · starting with a moderate plan');
  }
  if (learnedMin !== undefined) reasons.push(`You usually finish ~${fmt(learnedMin / 1.15)} of quests on days like this`);

  const e = clamp(input.energy / Math.max(1, input.maxEnergy), 0, 1);
  const energyFactor = 0.7 + 0.4 * e;
  minutes *= energyFactor;
  if (e < 0.4) reasons.push(`Energy ${Math.round(e * 100)}%: lighter day`);

  const last7 = recent.slice(0, 7);
  if (last7.length >= 4) {
    const rate = last7.reduce((s, x) => s + Math.min(x.completedMin, x.plannedMin), 0) / Math.max(1, last7.reduce((s, x) => s + x.plannedMin, 0));
    if (rate < 0.5) {
      minutes *= 0.85;
      reasons.push('Recent days were too full — trimming to protect consistency');
    } else if (rate > 0.9) {
      minutes *= 1.1;
      reasons.push('You have been finishing everything — a bit more room');
    }
  }

  if (input.adjustment !== 1) {
    minutes *= input.adjustment;
    reasons.push(input.adjustment > 1 ? 'More time this period' : 'Less time this period');
  }
  if (input.kind === 'rest') minutes *= 0.5;

  const n = input.history.length;
  return {
    minutes: Math.round(clamp(minutes, MIN_CAPACITY, MAX_CAPACITY)),
    freeMin,
    fraction,
    learnedMin: learnedMin !== undefined ? Math.round(learnedMin) : undefined,
    confidence: n >= 10 ? 'high' : n >= 3 ? 'medium' : 'low',
    reasons,
  };
}

/** Load score 0–100 from planned minutes vs capacity (100% of capacity ≈ 70). */
export function loadScore(plannedMin: number, capacityMin: number, energy: number, maxEnergy: number): number {
  const ratio = plannedMin / Math.max(MIN_CAPACITY, capacityMin);
  const fatigue = energy < maxEnergy / 2 ? ((maxEnergy / 2 - energy) / (maxEnergy / 2)) * 10 : 0;
  return Math.round(clamp(ratio * 70 + fatigue, 0, 100));
}

export function loadLevel(score: number): WorkloadLevel {
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

// ——— Priority-based balancing ———

export interface BalanceItem {
  id: string;
  /** Tier from the activity definition (before any balancing). */
  tier: QuestTier;
  importance: number;
  durationMin: number;
  /** Workouts and auto-tracked goals the player committed to. */
  protected?: boolean;
  /** The player said "Keep this task". */
  kept?: boolean;
}

export interface BalanceDecision {
  id: string;
  tier: QuestTier;
  lightened: boolean;
  reason?: string;
}

export interface BalanceResult {
  decisions: BalanceDecision[];
  /** Minutes of core + important work kept. */
  plannedMin: number;
  /** Capacity left for side quests. */
  leftoverMin: number;
}

/** Core quests are only ever lightened when they alone exceed capacity by this much. */
const CORE_OVERFLOW = 1.2;
/** Never lighten below this many effortful core quests. */
const CORE_FLOOR = 3;

const effortful = (q: BalanceItem) => q.durationMin > TRIVIAL_MINUTES;
const priority = (a: BalanceItem, b: BalanceItem) =>
  Number(!!b.kept) - Number(!!a.kept) || Number(!!b.protected) - Number(!!a.protected) || b.importance - a.importance || a.durationMin - b.durationMin;

/**
 * Fit the day into its capacity by priority: CORE stays, IMPORTANT fills what is left,
 * the rest becomes a no-pressure bonus. `keep_all` and `push` respect the player's call.
 */
export function balanceLoad(items: BalanceItem[], capacityMin: number, mode: LoadMode, opts: { importantCap?: number } = {}): BalanceResult {
  const decisions = new Map<string, BalanceDecision>(items.map((q) => [q.id, { id: q.id, tier: q.tier, lightened: false }]));
  const minutesOf = (list: BalanceItem[]) => list.reduce((s, q) => s + q.durationMin, 0);
  const core = items.filter((q) => q.tier === 'core');
  const important = items.filter((q) => q.tier === 'important');

  if (mode !== 'auto') {
    const planned = minutesOf([...core, ...important]);
    return { decisions: [...decisions.values()], plannedMin: planned, leftoverMin: Math.max(0, capacityMin - planned) + (mode === 'push' ? 45 : 0) };
  }

  // 1. Core: keep everything unless it alone overflows the day by a lot.
  let used = minutesOf(core);
  if (used > capacityMin * CORE_OVERFLOW) {
    const candidates = core.filter((q) => effortful(q) && !q.kept && !q.protected).sort(priority).reverse();
    let effortCount = core.filter(effortful).length;
    for (const q of candidates) {
      if (used <= capacityMin * CORE_OVERFLOW || effortCount <= CORE_FLOOR) break;
      decisions.set(q.id, { id: q.id, tier: 'important', lightened: true, reason: 'Lightened for a very full day — still worth doing, no pressure.' });
      used -= q.durationMin;
      effortCount--;
    }
  }

  // 2. Important: fill the remaining capacity by priority.
  let count = 0;
  const cap = opts.importantCap ?? Infinity;
  for (const q of [...important].sort(priority)) {
    const fits = !effortful(q) || q.kept || (used + q.durationMin <= capacityMin && count < cap);
    if (fits) {
      used += q.durationMin;
      if (effortful(q)) count++;
    } else {
      decisions.set(q.id, { id: q.id, tier: 'optional', lightened: true, reason: 'Bonus today: your day is already full. Do it if you can, no penalty if not.' });
    }
  }
  const planned = [...decisions.values()].filter((d) => d.tier !== 'optional').reduce((s, d) => s + (items.find((q) => q.id === d.id)?.durationMin ?? 0), 0);
  return { decisions: [...decisions.values()], plannedMin: planned, leftoverMin: Math.max(0, capacityMin - planned) };
}

// ——— Progressive complexity (first week) ———

export interface RampLimits {
  /** Max core objectives (excluding the first quest). */
  core: number;
  important: number;
  routines: boolean;
  /** Max side quests once they are unlocked. */
  side: number;
  label?: string;
}

/** Day 1 starts small; the board grows over the first week. */
export function rampLimits(dayIndex: number): RampLimits | undefined {
  if (dayIndex <= 0) return { core: 4, important: 0, routines: false, side: 2, label: 'Day 1 · Start small' };
  if (dayIndex <= 2) return { core: 6, important: 2, routines: true, side: 3, label: `Day ${dayIndex + 1} · Warming up` };
  if (dayIndex <= 6) return { core: 8, important: 4, routines: true, side: 4 };
  return undefined;
}
