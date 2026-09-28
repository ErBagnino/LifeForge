import type {
  MetricMap,
  NutritionTargets,
  Quest,
  ScoreBreakdown,
  ScoreComponent,
  ScoreRules,
  StepTargets,
  TierCount,
} from '@/types';
import { clamp } from '@/utils/math';

export interface ScoreInput {
  quests: Quest[];
  metrics: MetricMap;
  steps: StepTargets;
  waterTargetMl: number;
  nutrition: NutritionTargets;
  trackNutrition: boolean;
  restDay: boolean;
  /** Completed/total routine quests today, null when no routine is scheduled. */
  routine: TierCount | null;
  /** 7-day success ratio, null when not enough history. */
  consistency7d: number | null;
  achievementsToday: number;
}

/** Quests that count towards today's tiers ("moved" to another day are excluded). */
export function countedQuests(quests: Quest[]): Quest[] {
  return quests.filter((q) => q.status !== 'moved' && !q.hidden && q.kind !== 'weekly' && q.kind !== 'boss');
}

export function tierCount(quests: Quest[], tier: Quest['tier']): TierCount {
  const list = countedQuests(quests).filter((q) => q.tier === tier && q.skipReason !== 'sick');
  return { done: list.filter((q) => q.status === 'completed').length, total: list.length };
}

/** Steps: 70% of the component at the minimum target, 100% at the ideal target. */
export function stepsRatio(steps: number | undefined, targets: StepTargets): number {
  if (!steps || steps <= 0) return 0;
  if (steps >= targets.ideal) return 1;
  if (steps >= targets.min) {
    return 0.7 + (0.3 * (steps - targets.min)) / Math.max(1, targets.ideal - targets.min);
  }
  return (0.7 * steps) / Math.max(1, targets.min);
}

/** Calories: full marks inside the tolerance band, fading to 0 at 3.5× the tolerance. */
export function calorieRatio(calories: number | undefined, target: number, tolerancePct: number): number {
  if (!calories || calories <= 0 || target <= 0) return 0;
  const dev = Math.abs(calories - target) / target;
  const tol = tolerancePct / 100;
  if (dev <= tol) return 1;
  return clamp(1 - (dev - tol) / (tol * 2.5), 0, 1);
}

export function computeScore(input: ScoreInput, rules: ScoreRules): ScoreBreakdown {
  const w = rules.weights;
  const core = tierCount(input.quests, 'core');
  const important = tierCount(input.quests, 'important');
  const optional = tierCount(input.quests, 'optional');

  const ratio = (c: TierCount) => (c.total > 0 ? c.done / c.total : null);

  const workoutQuests = countedQuests(input.quests).filter((q) => q.kind === 'workout' || q.category === 'cardio');
  const workoutDone = workoutQuests.some((q) => q.status === 'completed');
  let physical: number | null;
  if (input.restDay) physical = null;
  else {
    const steps = stepsRatio(input.metrics.steps, input.steps);
    physical = workoutQuests.length > 0 ? 0.5 * steps + 0.5 * (workoutDone ? 1 : 0) : steps;
    if (workoutDone) physical = Math.max(physical, 0.75);
  }

  const nutrition = input.trackNutrition
    ? 0.5 * calorieRatio(input.metrics.calories, input.nutrition.calories, rules.calorieTolerancePct) +
      0.5 * clamp((input.metrics.protein ?? 0) / Math.max(1, input.nutrition.protein), 0, 1)
    : null;

  const hydration = clamp((input.metrics.water ?? 0) / Math.max(1, input.waterTargetMl), 0, 1);

  const optionalExpected = Math.min(rules.optionalExpected, optional.total);
  const optionalRatio = optionalExpected > 0 ? clamp(optional.done / optionalExpected, 0, 1) : null;

  const components: ScoreComponent[] = [
    { key: 'core', weight: w.core, ratio: ratio(core) },
    { key: 'important', weight: w.important, ratio: ratio(important) },
    { key: 'optional', weight: w.optional, ratio: optionalRatio },
    { key: 'physical', weight: w.physical, ratio: physical },
    { key: 'nutrition', weight: w.nutrition, ratio: nutrition },
    { key: 'hydration', weight: w.hydration, ratio: hydration },
    { key: 'routine', weight: w.routine, ratio: input.routine && input.routine.total > 0 ? input.routine.done / input.routine.total : null },
    { key: 'consistency', weight: w.consistency, ratio: input.consistency7d },
  ];

  const applicable = components.filter((c) => c.ratio !== null && c.weight > 0);
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0);
  const base = totalWeight > 0 ? (applicable.reduce((s, c) => s + c.weight * (c.ratio ?? 0), 0) / totalWeight) * 100 : 0;
  const bonus = Math.min(rules.achievementBonusMax, input.achievementsToday * rules.achievementBonusEach);
  const total = Math.round(clamp(base + bonus, 0, 100));
  return { components, base: Math.round(base), bonus, total };
}

export type ScoreGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export function scoreGrade(score: number): ScoreGrade {
  if (score >= 95) return 'S';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

export const SCORE_COMPONENT_LABELS: Record<ScoreComponent['key'], string> = {
  core: 'Core quests',
  important: 'Important quests',
  optional: 'Side quests',
  physical: 'Movement',
  nutrition: 'Nutrition',
  hydration: 'Hydration',
  routine: 'Routines',
  consistency: 'Consistency',
};

export interface ScoreContribution {
  key: ScoreComponent['key'];
  label: string;
  ratio: number;
  /** Share of the 100 points this component is worth today (after redistributing non-applicable ones). */
  worth: number;
  /** Points earned so far. */
  points: number;
  /** Points still available today (0 for history-based components). */
  left: number;
  changeable: boolean;
}

export interface ScoreExplanation {
  contributions: ScoreContribution[];
  notApplicable: string[];
  strongest?: ScoreContribution;
  weakest?: ScoreContribution;
  /** Biggest opportunities left today, largest first. */
  canStillChange: (ScoreContribution & { hint: string })[];
  /** Points missing to reach the streak line (0 when already there). */
  toThreshold: number;
  /** Highest score still reachable today if everything changeable is completed. */
  reachable: number;
}

const HINTS: Record<ScoreComponent['key'], string> = {
  core: 'Finish your core quests',
  important: 'Complete important quests',
  optional: 'Do a side quest or two',
  physical: 'Walk more or complete your workout',
  nutrition: 'Log meals close to your calorie and protein targets',
  hydration: 'Drink water up to your target',
  routine: 'Complete today’s routine',
  consistency: 'Built from the last 7 days',
};

/** Human explanation of a score breakdown: what each part is worth, what helped, what can still move. */
export function explainScore(b: ScoreBreakdown, threshold: number): ScoreExplanation {
  const applicable = b.components.filter((c) => c.ratio !== null && c.weight > 0);
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0) || 1;
  const contributions: ScoreContribution[] = applicable.map((c) => {
    const worth = (c.weight / totalWeight) * 100;
    const ratio = c.ratio ?? 0;
    const changeable = c.key !== 'consistency';
    return { key: c.key, label: SCORE_COMPONENT_LABELS[c.key], ratio, worth: round1(worth), points: round1(worth * ratio), left: changeable ? round1(worth * (1 - ratio)) : 0, changeable };
  });
  const ranked = [...contributions].filter((c) => c.worth >= 1).sort((a, b) => b.ratio - a.ratio || b.worth - a.worth);
  const distinct = ranked.length > 1 && ranked[0].ratio !== ranked[ranked.length - 1].ratio;
  const canStillChange = contributions
    .filter((c) => c.changeable && c.left >= 1)
    .sort((a, b) => b.left - a.left)
    .slice(0, 3)
    .map((c) => ({ ...c, hint: HINTS[c.key] }));
  const reachable = Math.min(100, Math.round(b.base + contributions.reduce((s, c) => s + c.left, 0) + b.bonus));
  return {
    contributions,
    notApplicable: b.components.filter((c) => c.ratio === null).map((c) => SCORE_COMPONENT_LABELS[c.key]),
    strongest: distinct ? ranked[0] : undefined,
    weakest: distinct ? ranked[ranked.length - 1] : undefined,
    canStillChange,
    toThreshold: Math.max(0, threshold - b.total),
    reachable,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
