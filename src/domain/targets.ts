import type { BodyGoal, SafetyBounds, StepTargets } from '@/types';
import { clamp, linearSlope, mean, roundTo } from '@/utils/math';

export interface TargetRecommendation<T> {
  action: 'increase' | 'decrease' | 'keep';
  next: T;
  reason: string;
}

/**
 * Dynamic step target: +1 increment when you hit the ideal on most recent days,
 * −1 when even the minimum is rarely reached. Increments are capped by the safety bounds.
 */
export function recommendStepTargets(
  last7: number[],
  current: StepTargets,
  safety: SafetyBounds,
): TargetRecommendation<StepTargets> {
  const logged = last7.filter((s) => s > 0);
  if (logged.length < 5) {
    return { action: 'keep', next: current, reason: 'Log steps on at least 5 of the last 7 days to adapt the target.' };
  }
  const hitIdeal = logged.filter((s) => s >= current.ideal).length;
  const hitMin = logged.filter((s) => s >= current.min).length;
  const build = (ideal: number): StepTargets => {
    const i = clamp(roundTo(ideal, safety.stepIncrement), safety.stepFloor, safety.stepCeiling);
    return {
      ideal: i,
      min: clamp(roundTo(i * 0.85, safety.stepIncrement), safety.stepFloor, i),
      stretch: clamp(roundTo(i * 1.3, safety.stepIncrement), i, safety.stepCeiling * 1.5),
    };
  };
  if (hitIdeal >= 5) {
    const maxInc = (current.ideal * safety.maxStepIncreasePct) / 100;
    const inc = Math.min(safety.stepIncrement, Math.max(roundTo(maxInc, 50), 50));
    const next = build(current.ideal + inc);
    if (next.ideal === current.ideal) return { action: 'keep', next: current, reason: 'You are at the configured ceiling.' };
    return {
      action: 'increase',
      next,
      reason: `Ideal target hit on ${hitIdeal} of the last ${logged.length} days. Small step up: ${next.ideal.toLocaleString('en-US')}.`,
    };
  }
  if (hitMin <= 2) {
    const next = build(current.ideal - safety.stepIncrement);
    if (next.ideal === current.ideal) return { action: 'keep', next: current, reason: 'Already at the minimum floor.' };
    return {
      action: 'decrease',
      next,
      reason: `Minimum reached only ${hitMin} times this week. Lower the bar slightly and win it back.`,
    };
  }
  return { action: 'keep', next: current, reason: 'Target is well calibrated. Keep going.' };
}

export interface WeightPoint {
  /** Days since an arbitrary origin. */
  day: number;
  kg: number;
}

/** kg per week from a least-squares fit. */
export function weightTrendPerWeek(points: WeightPoint[]): number {
  if (points.length < 3) return 0;
  return linearSlope(points.map((p) => ({ x: p.day, y: p.kg }))) * 7;
}

export interface CalorieInput {
  weights: WeightPoint[];
  loggedCalories: number[];
  adherence: number;
  goal: BodyGoal;
  currentTarget: number;
  bodyWeight: number;
  safety: SafetyBounds;
}

/**
 * Conservative calorie suggestion. Needs ≥2 weeks of weight data and good logging adherence.
 * Always a recommendation — the user decides.
 */
export function recommendCalories(input: CalorieInput): TargetRecommendation<number> {
  const { safety } = input;
  const span = input.weights.length ? input.weights[input.weights.length - 1].day - input.weights[0].day : 0;
  if (input.weights.length < 4 || span < 13) {
    return { action: 'keep', next: input.currentTarget, reason: 'Needs about two weeks of weigh-ins before suggesting changes.' };
  }
  if (input.adherence < 0.7) {
    return {
      action: 'keep',
      next: input.currentTarget,
      reason: 'Log nutrition on more days first — adjusting a target you are not tracking would be guessing.',
    };
  }
  const trend = weightTrendPerWeek(input.weights);
  const pctPerWeek = (trend / Math.max(1, input.bodyWeight)) * 100;
  const step = Math.min(100, safety.calorieMaxAdjust);
  const bound = (v: number) => clamp(roundTo(v, 25), safety.calorieMin, safety.calorieMax);
  const avgLogged = mean(input.loggedCalories);
  const fmt = (t: number) => `${t > 0 ? '+' : ''}${t.toFixed(2)} kg/week`;

  if (input.goal === 'lose') {
    if (pctPerWeek < -1) {
      const next = bound(input.currentTarget + step);
      return { action: 'increase', next, reason: `Losing fast (${fmt(trend)}). Suggest +${step} kcal to keep it sustainable.` };
    }
    if (trend > -0.1 && avgLogged <= input.currentTarget * 1.05) {
      const next = bound(input.currentTarget - step);
      if (next === input.currentTarget) return { action: 'keep', next, reason: 'Already at the configured minimum. Consider more movement instead.' };
      return { action: 'decrease', next, reason: `Weight flat (${fmt(trend)}) with good adherence. Suggest −${step} kcal.` };
    }
  } else if (input.goal === 'gain') {
    if (trend < 0.05) {
      const next = bound(input.currentTarget + step);
      return { action: 'increase', next, reason: `Weight not moving up (${fmt(trend)}). Suggest +${step} kcal.` };
    }
    if (pctPerWeek > 0.75) {
      const next = bound(input.currentTarget - step);
      return { action: 'decrease', next, reason: `Gaining fast (${fmt(trend)}). Suggest −${step} kcal.` };
    }
  } else if (Math.abs(trend) > 0.25) {
    const next = bound(input.currentTarget + (trend > 0 ? -step : step));
    return { action: trend > 0 ? 'decrease' : 'increase', next, reason: `Drifting ${fmt(trend)} while maintaining. Small correction.` };
  }
  return { action: 'keep', next: input.currentTarget, reason: `Trend ${fmt(trend)} matches your goal. Keep the target.` };
}

/** Protein suggestion only when the current target is outside the configured g/kg bounds. */
export function recommendProtein(current: number, bodyWeight: number, safety: SafetyBounds): TargetRecommendation<number> {
  const min = Math.round(bodyWeight * safety.proteinMinPerKg);
  const max = Math.round(bodyWeight * safety.proteinMaxPerKg);
  if (current < min) return { action: 'increase', next: roundTo(min, 5), reason: `Below ${safety.proteinMinPerKg} g/kg for ${bodyWeight} kg.` };
  if (current > max) return { action: 'decrease', next: roundTo(max, 5), reason: `Above ${safety.proteinMaxPerKg} g/kg for ${bodyWeight} kg.` };
  return { action: 'keep', next: current, reason: 'Inside your configured range.' };
}
