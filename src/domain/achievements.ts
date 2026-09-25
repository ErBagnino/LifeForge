import type { Achievement, Condition } from '@/types';

export type Counters = Record<string, number>;

export function evaluateCondition(cond: Condition, counters: Counters): boolean {
  switch (cond.type) {
    case 'counter':
      return (counters[cond.key] ?? 0) >= cond.gte;
    case 'all':
      return cond.of.every((c) => evaluateCondition(c, counters));
    case 'any':
      return cond.of.some((c) => evaluateCondition(c, counters));
  }
}

export interface ConditionProgress {
  current: number;
  target: number;
  ratio: number;
}

/** Progress toward a condition. Composite conditions report the average of their parts. */
export function conditionProgress(cond: Condition, counters: Counters): ConditionProgress {
  switch (cond.type) {
    case 'counter': {
      const current = Math.min(counters[cond.key] ?? 0, cond.gte);
      return { current, target: cond.gte, ratio: cond.gte > 0 ? current / cond.gte : 1 };
    }
    case 'all': {
      const parts = cond.of.map((c) => conditionProgress(c, counters));
      const ratio = parts.length ? parts.reduce((s, p) => s + p.ratio, 0) / parts.length : 1;
      return { current: parts.filter((p) => p.ratio >= 1).length, target: parts.length, ratio };
    }
    case 'any': {
      const parts = cond.of.map((c) => conditionProgress(c, counters));
      return parts.reduce((best, p) => (p.ratio > best.ratio ? p : best), { current: 0, target: 1, ratio: 0 });
    }
  }
}

/** Achievements that are locked but whose condition now holds. */
export function findNewlyUnlocked(achievements: Achievement[], counters: Counters): Achievement[] {
  return achievements.filter((a) => !a.unlockedAt && evaluateCondition(a.condition, counters));
}

/** Counter keys referenced by a condition (used to show what drives an achievement). */
export function conditionKeys(cond: Condition): string[] {
  return cond.type === 'counter' ? [cond.key] : cond.of.flatMap(conditionKeys);
}
