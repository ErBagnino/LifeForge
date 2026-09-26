import { workFromPlan } from '@/domain/schedule';
import { playerRepository, settingsRepository, statsRepository } from '@/repositories';
import { formatDate } from '@/utils/date';
import { clock } from '../clock';
import { planFor } from '../game/dayPlan';
import { loadDay } from '../game/questService';
import { contextSnapshot } from '../contextService';
import { dailyContextSummary } from './dailyContextSummary';

/**
 * Compact snapshot of the game sent with every Coach request. Short on purpose:
 * it replaces most read-tool calls for simple questions and saves Free Tier quota.
 * No meal photos, notes or chat history go in here.
 */
export async function buildContext(): Promise<string> {
  const [s, p] = await Promise.all([settingsRepository.get(), playerRepository.get()]);
  if (!s || !p) return '{}';
  const today = clock.today();
  const [plan, { day, long }, log, entries] = await Promise.all([planFor(today, s), loadDay(today), statsRepository.getLog(today), statsRepository.metricsByDate(today)]);
  const sum = (t: string) => Math.round(entries.filter((e) => e.type === t).reduce((x, e) => x + e.value, 0));
  const work = workFromPlan(plan);
  const pending = day.filter((q) => q.status === 'pending');
  const daily = await contextSnapshot().catch(() => undefined);
  const ctx = {
    dailyContext: daily ? dailyContextSummary(daily) : 'unknown',
    now: { date: today, weekday: formatDate(today, 'EEEE'), time: new Date(clock.now()).toTimeString().slice(0, 5) },
    player: { name: s.profile.nickname || p.name, level: p.level, coins: p.coins, hp: p.hp, energy: `${p.energy}/${p.maxEnergy}`, streak: p.streak.current },
    today: {
      work: work.status === 'set' || work.status === 'partial' ? `${work.start ?? '?'}–${work.end ?? '?'}` : work.status,
      score: log?.score ?? 0,
      load: log?.workloadLevel ?? null,
      freeMinutesEstimate: log?.capacityMin && log.plannedMin !== undefined ? Math.max(0, log.capacityMin - log.plannedMin) : null,
      done: day.filter((q) => q.status === 'completed').length,
      pending: pending.slice(0, 12).map((q) => ({ id: q.id, title: q.title, priority: q.tier, ...(q.scheduledTime ? { time: q.scheduledTime } : {}) })),
      morePending: Math.max(0, pending.length - 12),
      goals: long.slice(0, 4).map((q) => ({ id: q.id, title: q.title, until: q.endDate })),
    },
    nutritionToday: { kcal: `${sum('calories')}/${s.nutrition.calories}`, protein: `${sum('protein')}/${s.nutrition.protein}g`, waterMl: `${sum('water')}/${s.hydration.targetMl}` },
    targets: { steps: s.steps.ideal, goal: s.body.goal, weightKg: s.known.weight === 'set' ? s.body.weightKg : 'not set' },
    unknown: Object.entries(s.known)
      .filter(([, v]) => v !== 'set')
      .map(([k]) => k),
    safety: { kcal: [s.safety.calorieMin, s.safety.calorieMax], kcalMaxStep: s.safety.calorieMaxAdjust, waterMl: [s.safety.waterMinMl, s.safety.waterMaxMl], steps: [s.safety.stepFloor, s.safety.stepCeiling], maxTrainingIncreasePct: s.safety.maxTrainingIncreasePct },
  };
  return JSON.stringify(ctx);
}
