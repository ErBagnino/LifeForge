import { computeScore, countedQuests, tierCount } from '@/domain/score';
import type { DayLog, Quest, Routine, ScoreBreakdown, Settings, TierCount } from '@/types';

export function routineProgress(quests: Quest[], routines: Routine[]): TierCount | null {
  const ids = new Set(routines.filter((r) => r.active).flatMap((r) => r.activityIds));
  const list = countedQuests(quests).filter((q) => q.activityId && ids.has(q.activityId));
  if (!list.length) return null;
  return { done: list.filter((q) => q.status === 'completed').length, total: list.length };
}

/** Live Today Score for a day (also used at day close). */
export function scoreDay(settings: Settings, log: DayLog, quests: Quest[], routines: Routine[]): ScoreBreakdown {
  return computeScore(
    {
      quests: countedQuests(quests),
      metrics: log.metrics,
      steps: settings.steps,
      waterTargetMl: settings.hydration.targetMl,
      nutrition: settings.nutrition,
      trackNutrition: settings.tracking.nutrition,
      restDay: log.restDay,
      routine: routineProgress(quests, routines),
      consistency7d: log.consistency7d ?? null,
      achievementsToday: log.achievements.length,
    },
    settings.rules.score,
  );
}

/** Refresh the derived counters/score of a day log from its quests. */
export function refreshLog(log: DayLog, settings: Settings, quests: Quest[], routines: Routine[]): DayLog {
  const dayQuests = quests.filter((q) => q.date === log.date && q.kind !== 'weekly' && q.kind !== 'boss');
  const breakdown = scoreDay(settings, log, dayQuests, routines);
  return {
    ...log,
    core: tierCount(dayQuests, 'core'),
    important: tierCount(dayQuests, 'important'),
    optional: tierCount(dayQuests, 'optional'),
    score: breakdown.total,
    breakdown,
    workouts: dayQuests.filter((q) => q.kind === 'workout' && q.status === 'completed').length,
  };
}
