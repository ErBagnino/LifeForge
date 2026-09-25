import type { DayLog, ISODate, MetricMap, MetricType, Quest, QuestGoal } from '@/types';
import { countedQuests, tierCount } from './score';

export interface GoalTargets {
  stepsIdeal: number;
  waterMl: number;
  protein: number;
  calories: number;
}

export interface GoalContext {
  /** Day-scoped quests inside the goal's date range. */
  quests: Quest[];
  /** Closed or live day logs inside the range. */
  dayLogs: DayLog[];
  metricsByDate: Record<ISODate, MetricMap>;
  targets: GoalTargets;
}

export interface GoalProgress {
  progress: number;
  target: number;
  done: boolean;
}

function metricHit(metric: MetricType, value: number | undefined, t: GoalTargets): boolean {
  if (value === undefined) return false;
  switch (metric) {
    case 'steps':
      return value >= t.stepsIdeal;
    case 'water':
      return value >= t.waterMl;
    case 'protein':
      return value >= t.protein * 0.9;
    case 'calories':
      return Math.abs(value - t.calories) / Math.max(1, t.calories) <= 0.1;
    default:
      return value > 0;
  }
}

export function metricTargetFor(metric: MetricType, t: GoalTargets): number | undefined {
  switch (metric) {
    case 'steps':
      return t.stepsIdeal;
    case 'water':
      return t.waterMl;
    case 'protein':
      return t.protein;
    case 'calories':
      return t.calories;
    default:
      return undefined;
  }
}

function hourOf(ts: number): number {
  return new Date(ts).getHours();
}

/** Evaluate a declarative quest goal against the data in its date range. */
export function evaluateGoal(goal: QuestGoal, ctx: GoalContext): GoalProgress {
  const completed = countedQuests(ctx.quests).filter((q) => q.status === 'completed');
  const make = (progress: number, target: number): GoalProgress => ({
    progress: Math.min(progress, target),
    target,
    done: progress >= target,
  });

  switch (goal.type) {
    case 'completeCount': {
      const n = completed.filter(
        (q) =>
          (!goal.category || q.category === goal.category) &&
          (!goal.tier || q.tier === goal.tier) &&
          (!goal.kinds || goal.kinds.includes(q.kind)),
      ).length;
      return make(n, goal.count);
    }
    case 'metricSum': {
      const total = Object.values(ctx.metricsByDate).reduce((s, m) => s + (m[goal.metric] ?? 0), 0);
      return make(Math.round(total), goal.target);
    }
    case 'metricDays': {
      const n = Object.values(ctx.metricsByDate).filter((m) => metricHit(goal.metric, m[goal.metric], ctx.targets)).length;
      return make(n, goal.days);
    }
    case 'perfectCoreDays': {
      const byDate = new Map<ISODate, Quest[]>();
      for (const q of countedQuests(ctx.quests)) {
        const list = byDate.get(q.date) ?? [];
        list.push(q);
        byDate.set(q.date, list);
      }
      let n = 0;
      for (const list of byDate.values()) {
        const c = tierCount(list, 'core');
        if (c.total > 0 && c.done === c.total) n++;
      }
      return make(n, goal.days);
    }
    case 'workouts':
      return make(completed.filter((q) => q.kind === 'workout' || q.category === 'cardio').length, goal.count);
    case 'scoreDays':
      return make(ctx.dayLogs.filter((d) => d.score >= goal.minScore).length, goal.days);
    case 'completeBefore':
      return make(completed.filter((q) => q.completedAt !== undefined && hourOf(q.completedAt) < goal.hour && hourOf(q.completedAt) >= 4).length, goal.count);
    case 'allCore': {
      const c = tierCount(ctx.quests, 'core');
      return make(c.total > 0 && c.done === c.total ? 1 : 0, 1);
    }
    case 'allTiers': {
      const c = tierCount(ctx.quests, 'core');
      const i = tierCount(ctx.quests, 'important');
      const total = c.total + i.total;
      return make(total > 0 && c.done + i.done === total ? 1 : 0, 1);
    }
    case 'metricAtLeast': {
      const value = Object.values(ctx.metricsByDate).reduce((mx, m) => Math.max(mx, m[goal.metric] ?? 0), 0);
      return make(Math.round(value), goal.value);
    }
    case 'categoriesTouched':
      return make(new Set(completed.map((q) => q.category)).size, goal.count);
  }
}

export function describeGoal(goal: QuestGoal): string {
  switch (goal.type) {
    case 'completeCount':
      return `Complete ${goal.count} ${goal.category ? goal.category.replace(/_/g, ' ') + ' ' : ''}${goal.kinds?.includes('side') ? 'side ' : ''}quests`;
    case 'metricSum':
      return `Reach ${goal.target.toLocaleString('en-US')} total ${goal.metric}`;
    case 'metricDays':
      return `Hit your ${goal.metric} target on ${goal.days} days`;
    case 'perfectCoreDays':
      return `Complete every core quest on ${goal.days} days`;
    case 'workouts':
      return `Complete ${goal.count} workouts`;
    case 'scoreDays':
      return `Score ${goal.minScore}+ on ${goal.days} days`;
    case 'completeBefore':
      return `Complete ${goal.count} quest${goal.count > 1 ? 's' : ''} before ${goal.hour}:00`;
    case 'allCore':
      return 'Complete every core quest today';
    case 'allTiers':
      return 'Complete every core and important quest today';
    case 'metricAtLeast':
      return `Reach ${goal.value.toLocaleString('en-US')} ${goal.metric} today`;
    case 'categoriesTouched':
      return `Complete quests in ${goal.count} different categories`;
  }
}
