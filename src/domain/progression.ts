import type { ExerciseMeasure, ProgressionRule, ProgressionSuggestion, SetLog } from '@/types';
import { floorTo, mean, roundTo } from '@/utils/math';

export interface ExerciseHistoryEntry {
  date: string;
  weight: number;
  repMin: number;
  repMax: number;
  targetSets: number;
  sets: SetLog[];
}

export interface ExerciseAnalysis {
  completedSets: number;
  targetSets: number;
  allCompleted: boolean;
  /** Every set at or above the top of the rep range. */
  allTop: boolean;
  /** Every set at or above the middle of the rep range. */
  allMid: boolean;
  anyBelowMin: boolean;
  avgRpe: number | null;
  maxRpe: number | null;
  failure: boolean;
  volume: number;
  topWeight: number;
  bestReps: number;
}

export function analyzeExercise(entry: ExerciseHistoryEntry): ExerciseAnalysis {
  const done = entry.sets.filter((s) => s.completed);
  const rpes = done.map((s) => s.rpe).filter((r): r is NonNullable<typeof r> => r !== undefined);
  const mid = (entry.repMin + entry.repMax) / 2;
  const allCompleted = done.length >= entry.targetSets;
  const anyBelowMin = done.some((s) => s.reps < entry.repMin);
  const maxRpe = rpes.length ? Math.max(...rpes) : null;
  return {
    completedSets: done.length,
    targetSets: entry.targetSets,
    allCompleted,
    allTop: done.length > 0 && done.every((s) => s.reps >= entry.repMax),
    allMid: done.length > 0 && done.every((s) => s.reps >= mid),
    anyBelowMin,
    avgRpe: rpes.length ? mean(rpes) : null,
    maxRpe,
    failure: !allCompleted || anyBelowMin || maxRpe === 4,
    volume: done.reduce((s, x) => s + x.weight * x.reps, 0),
    topWeight: done.reduce((m, x) => Math.max(m, x.weight), 0),
    bestReps: done.reduce((m, x) => Math.max(m, x.reps), 0),
  };
}

/** Failed sessions in a row, newest first. */
export function consecutiveFailures(history: ExerciseHistoryEntry[]): number {
  let n = 0;
  for (const h of history) {
    if (analyzeExercise(h).failure) n++;
    else break;
  }
  return n;
}

/** Epley estimated one-rep max, used for trends. */
export function estimated1RM(weight: number, reps: number): number {
  return reps <= 0 ? 0 : weight * (1 + reps / 30);
}

/** Sessions in a row (newest first) where the best set improved on the previous session. */
export function improvementStreak(history: ExerciseHistoryEntry[]): number {
  const scores = history.map((h) => {
    const done = h.sets.filter((s) => s.completed);
    return done.reduce((m, s) => Math.max(m, estimated1RM(s.weight || 1, s.reps)), 0);
  });
  let n = 0;
  for (let i = 0; i < scores.length - 1; i++) {
    if (scores[i] > scores[i + 1] + 0.01) n++;
    else break;
  }
  return n;
}

export interface ProgressionInput {
  measure: ExerciseMeasure;
  bodyweight: boolean;
  current: { weight: number; repMin: number; repMax: number };
  /** Newest first. */
  history: ExerciseHistoryEntry[];
  rule: ProgressionRule;
  /** Global safety cap from settings. */
  maxIncreasePct: number;
}

/**
 * Suggest the next session's load. Never increases blindly: it needs data, clean
 * sets and manageable effort. Failures lead to "stay", "step back" or a deload — never punishment.
 */
export function suggestProgression(input: ProgressionInput): ProgressionSuggestion {
  const { current, history, rule } = input;
  const base = {
    currentWeight: current.weight,
    nextWeight: current.weight,
    repMin: current.repMin,
    repMax: current.repMax,
  };
  if (history.length === 0) {
    return { ...base, action: 'none', reason: 'Log a session to unlock suggestions.', confidence: 'low' };
  }

  const last = history[0];
  const a = analyzeExercise(last);
  const fails = consecutiveFailures(history);
  const w = last.weight || current.weight;
  const unit = input.measure === 'time' ? 's' : input.bodyweight ? ' reps' : ' kg';
  const step = Math.min(rule.increment, 2.5) || 0.5;

  if (fails >= rule.failuresBeforeDeload) {
    if (input.bodyweight || input.measure === 'time') {
      const repMax = Math.max(current.repMin, current.repMax - 2);
      return {
        ...base,
        action: 'deload',
        repMax,
        reason: `Last ${fails} sessions fell short. Trim the target for a week and rebuild.`,
        confidence: 'high',
      };
    }
    const next = Math.max(rule.minWeight, roundTo(w * (1 - rule.deloadPct / 100), step));
    return {
      ...base,
      action: 'deload',
      nextWeight: next,
      reason: `Last ${fails} sessions fell short at ${w}${unit}. A short deload to ${next}${unit} rebuilds momentum.`,
      confidence: 'high',
    };
  }

  if (fails === 2) {
    const lighter = history.slice(1).find((h) => h.weight < w && !analyzeExercise(h).failure);
    if (lighter && a.anyBelowMin) {
      return {
        ...base,
        action: 'decrease',
        nextWeight: lighter.weight,
        reason: `Last 2 sessions were difficult at ${w}${unit}. Return temporarily to ${lighter.weight}${unit}.`,
        confidence: 'medium',
      };
    }
    return {
      ...base,
      action: 'maintain',
      reason: `Last 2 sessions were difficult at ${w}${unit}. Stay at ${w}${unit} and own it.`,
      confidence: 'medium',
    };
  }

  if (fails === 1) {
    return {
      ...base,
      action: 'maintain',
      reason: `One tough session is not a trend. Stay at ${w}${unit}.`,
      confidence: 'medium',
    };
  }

  const easyEnough = a.avgRpe !== null ? a.avgRpe <= rule.easyRpeMax : false;
  const veryEasy = a.avgRpe !== null && a.avgRpe <= 1.2;
  const topReached = rule.requireTopOfRange ? a.allTop || (veryEasy && a.allMid) : a.allMid;
  const setsOk = rule.requireAllSets ? a.allCompleted : a.completedSets > 0;
  const confidence = history.length >= 2 && !analyzeExercise(history[1]).failure ? 'high' : 'medium';

  if (setsOk && topReached && easyEnough) {
    if (input.bodyweight || input.measure === 'time') {
      const inc = input.measure === 'time' ? rule.increment : 2;
      return {
        ...base,
        action: 'increase_reps',
        repMin: current.repMin + inc,
        repMax: current.repMax + inc,
        reason: `All sets clean and ${a.avgRpe !== null && a.avgRpe <= 1 ? 'easy' : 'under control'}. Add ${inc}${input.measure === 'time' ? ' seconds' : ' reps'}.`,
        confidence,
      };
    }
    const cap = Math.min(rule.maxIncreasePct, input.maxIncreasePct);
    const allowed = (w * cap) / 100;
    let inc = rule.increment;
    let note = '';
    if (inc > allowed) {
      const smaller = floorTo(allowed, 0.5);
      if (smaller >= 0.5) {
        inc = smaller;
        note = ' (smaller jump, safety cap)';
      } else {
        return {
          ...base,
          action: 'increase_reps',
          repMax: current.repMax + 2,
          reason: `Weight jump would exceed the ${cap}% safety cap. Push reps to ${current.repMax + 2} first.`,
          confidence,
        };
      }
    }
    const next = roundTo(w + inc, 0.5);
    return {
      ...base,
      action: 'increase',
      nextWeight: next,
      repMin: current.repMin,
      repMax: Math.min(current.repMax, current.repMin + 2),
      reason: `All ${a.completedSets} sets done, reps on target, effort ${a.avgRpe !== null && a.avgRpe <= 1 ? 'easy' : 'manageable'}. Try ${next}${unit}${note}.`,
      confidence,
    };
  }

  if (setsOk && topReached) {
    return {
      ...base,
      action: 'maintain',
      reason: `Target reached but it felt hard. Repeat ${w}${unit} until it feels normal.`,
      confidence,
    };
  }

  if (setsOk) {
    return {
      ...base,
      action: 'increase_reps',
      reason: `Sets done at ${w}${unit}. Aim for +1 rep per set before adding weight.`,
      confidence,
    };
  }

  return { ...base, action: 'maintain', reason: `Consolidate at ${w}${unit}.`, confidence: 'low' };
}

export const RPE_INFO: Record<1 | 2 | 3 | 4, { emoji: string; label: string }> = {
  1: { emoji: '😎', label: 'Easy' },
  2: { emoji: '🙂', label: 'Normal' },
  3: { emoji: '😰', label: 'Hard' },
  4: { emoji: '💀', label: 'Almost impossible' },
};
