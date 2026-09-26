import { computeWorkload, dayCapacity, type WorkloadResult } from '@/domain/workload';
import { daysLeftInWeek, isDueOn } from '@/domain/recurrence';
import { type CoachData, generateInsights, type Insight } from '@/domain/coach';
import { learnTimes } from '@/domain/habits';
import { improvementStreak } from '@/domain/progression';
import { weightTrendPerWeek } from '@/domain/targets';
import { countedQuests } from '@/domain/score';
import {
  achievementRepository,
  activityRepository,
  metricsByDay,
  playerRepository,
  questRepository,
  settingsRepository,
  statsRepository,
  workoutRepository,
} from '@/repositories';
import type {
  Achievement,
  ActivityCategory,
  DayLog,
  ISODate,
  MetricMap,
  Quest,
  WorkoutSession,
} from '@/types';
import { dateRange, daysBetween, hmToMinutes, isWeekend, minutesToHm, shiftDate, weekday, weekEnd, weekStart } from '@/utils/date';
import { mean } from '@/utils/math';
import { clock } from './clock';
import { planFor, trainingAvailable } from './game/dayPlan';
import { adventureDay } from './game/load';
import { rampLimits } from '@/domain/capacity';
import { exerciseHistory } from './workoutService';

export interface TomorrowForecast {
  date: ISODate;
  workload: WorkloadResult;
  questCount: number;
  workout?: string;
  dayType: string;
}

export async function tomorrowForecast(): Promise<TomorrowForecast | undefined> {
  const settings = await settingsRepository.get();
  if (!settings) return undefined;
  const date = shiftDate(clock.today(), 1);
  const plan = await planFor(date, settings);
  const activities = await activityRepository.active();
  const history = await questRepository.byRange(shiftDate(date, -14), clock.today());
  const ws = weekStart(date);
  const due = activities.filter((a) => {
    if (a.recurrence.type === 'pool') return false;
    const mine = history.filter((q) => q.activityId === a.id && q.status === 'completed');
    return isDueOn(a, {
      date,
      dayType: plan.dayType,
      trainingAvailable: trainingAvailable(date, settings, plan),
      completedThisWeek: mine.filter((q) => q.date >= ws).length,
      lastCompletedDate: mine.map((q) => q.date).sort().at(-1),
      daysLeftInWeek: daysLeftInWeek(date),
    });
  });
  // Same first-week ramp as the real board, so the forecast never promises more than will appear.
  const player = await playerRepository.get();
  const ramp = player ? rampLimits(await adventureDay(date, player, settings)) : undefined;
  if (ramp) {
    const byImportance = (tier: string) => due.filter((a) => a.tier === tier).sort((a, b) => b.importance - a.importance);
    const kept = [...byImportance('core').slice(0, ramp.core), ...byImportance('important').slice(0, ramp.important), ...(ramp.routines ? byImportance('optional') : [])];
    due.splice(0, due.length, ...kept);
  }
  const workoutPlan = await workoutRepository.activePlan();
  const template = plan.dayType !== 'rest' ? workoutPlan?.templates.find((t) => t.weekday === weekday(date)) : undefined;
  const workload = computeWorkload({
    capacity: dayCapacity(plan),
    questMinutes: due.reduce((s, a) => s + a.durationMin, 0) + (template?.estimatedMin ?? 0),
    questEnergy: 0,
    workoutScheduled: !!template,
    energyStart: 85,
  });
  return { date, workload, questCount: due.length + (template ? 1 : 0), workout: template?.name, dayType: plan.dayType };
}

export interface DailyRecap {
  log?: DayLog;
  quests: Quest[];
  achievements: Achievement[];
  sessions: WorkoutSession[];
  tomorrow?: TomorrowForecast;
}

export async function dailyRecap(date: ISODate): Promise<DailyRecap> {
  const [log, quests, all, sessions, tomorrow] = await Promise.all([
    statsRepository.getLog(date),
    questRepository.byDate(date),
    achievementRepository.all(),
    workoutRepository.sessionsRange(date, date),
    date === clock.today() ? tomorrowForecast() : Promise.resolve(undefined),
  ]);
  return {
    log,
    quests: quests.filter((q) => q.kind !== 'weekly' && q.kind !== 'boss'),
    achievements: all.filter((a) => log?.achievements.includes(a.id)),
    sessions: sessions.filter((s) => s.status === 'completed'),
    tomorrow,
  };
}

function categoryStats(quests: Quest[]): { strongest?: ActivityCategory; weakest?: ActivityCategory; byCategory: Record<string, { done: number; total: number }> } {
  const by: Record<string, { done: number; total: number }> = {};
  for (const q of countedQuests(quests)) {
    const c = (by[q.category] ??= { done: 0, total: 0 });
    c.total++;
    if (q.status === 'completed') c.done++;
  }
  const rated = Object.entries(by).filter(([, v]) => v.total >= 2).map(([k, v]) => ({ k: k as ActivityCategory, r: v.done / v.total, n: v.total }));
  rated.sort((a, b) => b.r - a.r || b.n - a.n);
  // Only name a strongest / weakest area when the numbers actually differ (0/2 everywhere says nothing).
  const best = rated[0];
  const worst = rated.length > 1 ? rated[rated.length - 1] : undefined;
  const differs = !!best && !!worst && best.r > worst.r;
  return { strongest: best && best.r > 0 && (differs || rated.length === 1) ? best.k : undefined, weakest: differs ? worst!.k : undefined, byCategory: by };
}

export interface WeeklyReview {
  from: ISODate;
  to: ISODate;
  logs: DayLog[];
  avgScore: number | null;
  prevAvgScore: number | null;
  xp: number;
  coins: number;
  workouts: number;
  steps: number;
  avgSteps: number | null;
  consistency: number;
  coreRate: number | null;
  strongest?: ActivityCategory;
  weakest?: ActivityCategory;
  byCategory: Record<string, { done: number; total: number }>;
  achievements: Achievement[];
  weightTrend?: number;
  insights: Insight[];
}

export async function weeklyReview(anyDate: ISODate = clock.today()): Promise<WeeklyReview> {
  const from = weekStart(anyDate);
  const to = weekEnd(anyDate);
  const [logs, prevLogs, quests, sessions, all, weights] = await Promise.all([
    statsRepository.logs(from, to),
    statsRepository.logs(shiftDate(from, -7), shiftDate(from, -1)),
    questRepository.byRange(from, to),
    workoutRepository.sessionsRange(from, to),
    achievementRepository.all(),
    statsRepository.metricsOfType('weight', shiftDate(to, -21), to),
  ]);
  const scored = logs.filter((l) => l.closed || l.date === clock.today());
  const steps = logs.reduce((s, l) => s + (l.metrics.steps ?? 0), 0);
  const stepDays = logs.filter((l) => (l.metrics.steps ?? 0) > 0);
  const core = logs.reduce((acc, l) => ({ d: acc.d + l.core.done, t: acc.t + l.core.total }), { d: 0, t: 0 });
  const cats = categoryStats(quests);
  const weightTrend = weights.length >= 3 ? weightTrendPerWeek(weights.map((w) => ({ day: daysBetween(from, w.date), kg: w.value }))) : undefined;
  const insights = await getInsights();
  return {
    from,
    to,
    logs,
    avgScore: scored.length ? Math.round(mean(scored.map((l) => l.score))) : null,
    prevAvgScore: prevLogs.length ? Math.round(mean(prevLogs.map((l) => l.score))) : null,
    xp: logs.reduce((s, l) => s + l.xp, 0),
    coins: logs.reduce((s, l) => s + l.coins, 0),
    workouts: sessions.filter((s) => s.status === 'completed' && s.kind === 'strength').length,
    steps,
    avgSteps: stepDays.length ? Math.round(steps / stepDays.length) : null,
    consistency: logs.filter((l) => l.success).length / 7,
    coreRate: core.t ? core.d / core.t : null,
    strongest: cats.strongest,
    weakest: cats.weakest,
    byCategory: cats.byCategory,
    achievements: all.filter((a) => a.unlockedAt && a.unlockedAt >= Date.parse(from) && a.unlockedAt <= Date.parse(to) + 86400000 * 1.2),
    weightTrend,
    insights,
  };
}

/** Assemble the numbers the rule-based Coach reasons about. */
export async function coachData(): Promise<CoachData | undefined> {
  const [settings, player] = await Promise.all([settingsRepository.get(), playerRepository.get()]);
  if (!settings || !player) return undefined;
  const today = clock.today();
  const from28 = shiftDate(today, -28);
  const [logs, quests, metrics, exercises] = await Promise.all([
    statsRepository.logs(from28, today),
    questRepository.byRange(from28, today),
    statsRepository.metricsRange(shiftDate(today, -21), today),
    workoutRepository.exercises.all(),
  ]);
  const thisWeek = logs.filter((l) => daysBetween(l.date, today) < 7);
  const lastWeek = logs.filter((l) => daysBetween(l.date, today) >= 7 && daysBetween(l.date, today) < 14);
  const core = thisWeek.reduce((a, l) => ({ d: a.d + l.core.done, t: a.t + l.core.total }), { d: 0, t: 0 });

  const byWeekday: Record<number, { d: number; t: number }> = {};
  for (const q of countedQuests(quests)) {
    const w = weekday(q.date);
    byWeekday[w] ??= { d: 0, t: 0 };
    byWeekday[w].t++;
    if (q.status === 'completed') byWeekday[w].d++;
  }
  const bestWeekday = Object.entries(byWeekday)
    .filter(([, v]) => v.t >= 5)
    .map(([k, v]) => ({ weekday: Number(k), rate: v.d / v.t }))
    .sort((a, b) => b.rate - a.rate)[0];

  const waterRate = (list: DayLog[]) => (list.length ? list.filter((l) => (l.metrics.water ?? 0) >= settings.hydration.targetMl).length / list.length : null);
  const stepAvg = (list: DayLog[]) => {
    const s = list.map((l) => l.metrics.steps ?? 0).filter((x) => x > 0);
    return s.length ? mean(s) : null;
  };

  const improvements: { name: string; sessions: number }[] = [];
  for (const ex of exercises.slice(0, 40)) {
    const h = await exerciseHistory(ex.id, 6);
    const n = improvementStreak(h);
    if (n >= 3) improvements.push({ name: ex.name, sessions: n });
  }

  const samples = quests
    .filter((q) => q.status === 'completed' && q.activityId && q.completedAt)
    .map((q) => ({ activityId: q.activityId!, minute: q.actualTime ? hmToMinutes(q.actualTime) : new Date(q.completedAt!).getHours() * 60, weekend: isWeekend(q.date) }));
  const learned = learnTimes(samples, 4);
  const activities = await activityRepository.all();
  const timeShifts = learned
    .filter((l) => l.weekdayMedian !== undefined && l.weekendMedian !== undefined && Math.abs(l.weekendMedian - l.weekdayMedian) >= 45)
    .map((l) => ({
      name: activities.find((a) => a.id === l.activityId)?.name.replace(/\{pet\}/g, settings.profile.petName) ?? l.activityId,
      weekday: minutesToHm(l.weekdayMedian!),
      weekend: minutesToHm(l.weekendMedian!),
      laterOnWeekend: l.weekendMedian! > l.weekdayMedian!,
    }));

  const snoozed = new Map<string, { name: string; count: number }>();
  for (const q of quests.filter((x) => daysBetween(x.date, today) <= 10)) {
    if (!q.activityId) continue;
    const n = q.snoozeCount + (q.status === 'moved' ? 1 : 0);
    if (!n) continue;
    const cur = snoozed.get(q.activityId) ?? { name: q.title, count: 0 };
    cur.count += n;
    snoozed.set(q.activityId, cur);
  }
  const snoozeHeavy = [...snoozed.values()].sort((a, b) => b.count - a.count)[0];

  const weights = metrics.filter((m) => m.type === 'weight').map((m) => ({ day: daysBetween(from28, m.date), kg: m.value }));
  const cats = categoryStats(quests.filter((q) => daysBetween(q.date, today) < 14));
  const tomorrow = await tomorrowForecast();
  const todayQuests = countedQuests(quests.filter((q) => q.date === today));
  const coreToday = todayQuests.filter((q) => q.tier === 'core');

  return {
    seed: today,
    tone: settings.tone,
    hour: clock.hour(),
    week: {
      coreRate: core.t ? core.d / core.t : null,
      avgScore: thisWeek.length ? mean(thisWeek.map((l) => l.score)) : null,
      prevAvgScore: lastWeek.length ? mean(lastWeek.map((l) => l.score)) : null,
      days: thisWeek.length,
    },
    bestWeekday,
    hydration: { thisWeek: waterRate(thisWeek.filter((l) => l.closed)), lastWeek: waterRate(lastWeek) },
    steps: { thisWeekAvg: stepAvg(thisWeek), lastWeekAvg: stepAvg(lastWeek) },
    weight: weights.length >= 3 ? { trendPerWeek: weightTrendPerWeek(weights), goal: settings.body.goal } : undefined,
    improvements,
    timeShifts,
    tomorrow: tomorrow ? { workload: tomorrow.workload.score, level: tomorrow.workload.level } : undefined,
    streak: player.streak.current,
    hp: player.hp,
    energy: player.energy,
    recoveryMode: player.recoveryMode,
    snoozeHeavy,
    strongestCategory: cats.strongest,
    weakestCategory: cats.weakest,
    pendingCore: coreToday.filter((q) => q.status === 'pending').length,
    totalCore: coreToday.length,
  };
}

export async function getInsights(): Promise<Insight[]> {
  const data = await coachData();
  return data ? generateInsights(data) : [];
}

// ——— Chart series ———

export interface DayPoint {
  date: ISODate;
  label: string;
  score: number;
  xp: number;
  coins: number;
  steps: number;
  water: number;
  calories: number;
  protein: number;
  leisure: number;
  weight?: number;
  completion: number;
  workouts: number;
  streak: number;
}

export async function dailySeries(from: ISODate, to: ISODate): Promise<DayPoint[]> {
  const [logs, metrics] = await Promise.all([statsRepository.logs(from, to), statsRepository.metricsRange(from, to)]);
  const byLog = new Map(logs.map((l) => [l.date, l]));
  const byMetric: Record<ISODate, MetricMap> = metricsByDay(metrics);
  return dateRange(from, to).map((date) => {
    const l = byLog.get(date);
    const m = byMetric[date] ?? l?.metrics ?? {};
    const total = (l?.core.total ?? 0) + (l?.important.total ?? 0) + (l?.optional.total ?? 0);
    const done = (l?.core.done ?? 0) + (l?.important.done ?? 0) + (l?.optional.done ?? 0);
    return {
      date,
      label: date.slice(5).replace('-', '/'),
      score: l?.score ?? 0,
      xp: l?.xp ?? 0,
      coins: l?.coins ?? 0,
      steps: m.steps ?? 0,
      water: m.water ?? 0,
      calories: m.calories ?? 0,
      protein: m.protein ?? 0,
      leisure: m.leisure ?? 0,
      weight: m.weight,
      completion: total ? done / total : 0,
      workouts: l?.workouts ?? 0,
      streak: l?.streak ?? 0,
    };
  });
}

export async function workoutVolumeSeries(limit = 30): Promise<{ date: string; label: string; volume: number; name: string }[]> {
  const sessions = (await workoutRepository.recentSessions(limit)).filter((s) => s.kind === 'strength').reverse();
  return sessions.map((s) => ({
    date: s.date,
    label: s.date.slice(5).replace('-', '/'),
    volume: Math.round(s.exercises.flatMap((e) => e.sets.filter((x) => x.completed)).reduce((sum, x) => sum + x.weight * x.reps, 0)),
    name: s.name,
  }));
}

export async function categoryPerformance(days = 30): Promise<{ category: ActivityCategory; done: number; total: number; rate: number }[]> {
  const today = clock.today();
  const quests = await questRepository.byRange(shiftDate(today, -days), today);
  const { byCategory } = categoryStats(quests);
  return Object.entries(byCategory)
    .map(([category, v]) => ({ category: category as ActivityCategory, ...v, rate: v.total ? v.done / v.total : 0 }))
    .sort((a, b) => b.total - a.total);
}
