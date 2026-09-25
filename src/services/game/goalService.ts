import { evaluateGoal, type GoalContext } from '@/domain/goals';
import { metricsByDay, questRepository, statsRepository } from '@/repositories';
import type { DayLog, ISODate, Quest, Settings } from '@/types';

function targetsOf(settings: Settings) {
  return {
    stepsIdeal: settings.steps.ideal,
    waterMl: settings.hydration.targetMl,
    protein: settings.nutrition.protein,
    calories: settings.nutrition.calories,
  };
}

/** Goal context for a single day (challenge / hidden quests). */
export function dayGoalContext(settings: Settings, log: DayLog, dayQuests: Quest[]): GoalContext {
  return {
    quests: dayQuests,
    dayLogs: [log],
    metricsByDate: { [log.date]: log.metrics },
    targets: targetsOf(settings),
  };
}

/** Goal context for a multi-day window (weekly / boss), using today's live log. */
export async function rangeGoalContext(settings: Settings, from: ISODate, to: ISODate, liveLog: DayLog): Promise<GoalContext> {
  const [quests, logs, metrics] = await Promise.all([
    questRepository.byRange(from, to),
    statsRepository.logs(from, to),
    statsRepository.metricsRange(from, to),
  ]);
  const dayLogs = logs.filter((l) => l.date !== liveLog.date);
  if (liveLog.date >= from && liveLog.date <= to) dayLogs.push(liveLog);
  const byDay = metricsByDay(metrics);
  if (liveLog.date >= from && liveLog.date <= to) byDay[liveLog.date] = liveLog.metrics;
  return {
    quests: quests.filter((q) => q.kind !== 'weekly' && q.kind !== 'boss'),
    dayLogs,
    metricsByDate: byDay,
    targets: targetsOf(settings),
  };
}

/**
 * Update progress on goal quests. Returns the quests that just reached their goal
 * (the caller grants rewards).
 */
export async function evaluateGoalQuests(settings: Settings, log: DayLog, dayQuests: Quest[], longQuests: Quest[]): Promise<Quest[]> {
  const reached: Quest[] = [];
  const updates: Quest[] = [];
  const dayCtx = dayGoalContext(settings, log, dayQuests);
  for (const q of dayQuests) {
    if (!q.goal || q.status !== 'pending') continue;
    const p = evaluateGoal(q.goal, dayCtx);
    if (p.progress !== q.progress || p.target !== q.target) updates.push({ ...q, progress: p.progress, target: p.target });
    if (p.done) reached.push(q);
  }
  for (const q of longQuests) {
    if (!q.goal || q.status !== 'pending' || !q.endDate) continue;
    const to = log.date < q.endDate ? log.date : q.endDate;
    const ctx = await rangeGoalContext(settings, q.date, to, log);
    const p = evaluateGoal(q.goal, ctx);
    if (p.progress !== q.progress || p.target !== q.target) updates.push({ ...q, progress: p.progress, target: p.target });
    if (p.done) reached.push(q);
  }
  if (updates.length) await questRepository.bulkPut(updates.map((u) => ({ ...u, updatedAt: Date.now() })));
  const updated = new Map(updates.map((u) => [u.id, u]));
  return reached.map((q) => updated.get(q.id) ?? q);
}
