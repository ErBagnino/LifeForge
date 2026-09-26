import { derivedCounters, mergeCounters } from '@/domain/counters';
import { levelFromXp } from '@/domain/level';
import { profileFields } from '@/domain/profile';
import { activeSchedule, summarizeSchedule, upcomingSchedules } from '@/domain/schedule';
import { buildingCost, homeLevel } from '@/domain/tycoon';
import {
  achievementRepository,
  activityRepository,
  playerRepository,
  questRepository,
  settingsRepository,
  routineRepository,
  statsRepository,
  tycoonRepository,
  workoutRepository,
} from '@/repositories';
import type { Player, Quest, Settings } from '@/types';
import { shiftDate, daysBetween } from '@/utils/date';
import { clock } from '../../clock';
import { loadDay } from '../../game/questService';
import { weeklyReview } from '../../insightsService';
import { upcomingTemporary } from '../../scheduleService';
import { sessionStats } from '../../workoutService';
import { recentChanges } from '../changeLog';
import { contextSnapshot } from '../../contextService';
import { dailyContextSummary } from '../dailyContextSummary';
import { COUNTER_CATALOG } from './counters';

/** Read tools: compact JSON for the model (every token counts against the Free Tier). */

export interface ReadCtx {
  settings: Settings;
  player: Player;
  today: string;
}

export class ToolError extends Error {}

const questRow = (q: Quest) => ({
  id: q.id,
  title: q.title,
  date: q.date,
  ...(q.endDate ? { endDate: q.endDate } : {}),
  kind: q.kind,
  priority: q.tier,
  status: q.status,
  ...(q.scheduledTime ? { time: q.scheduledTime } : {}),
  durationMin: q.durationMin,
  xp: q.xp,
  coins: q.coins,
  ...(q.target ? { progress: `${Math.round(q.progress)}/${q.target}${q.unit ? ' ' + q.unit : ''}` } : {}),
  ...(q.activityId ? { activityId: q.activityId } : {}),
});

const recurrenceText = (r: { type: string; days?: number[]; times?: number; n?: number }) =>
  r.type === 'weekdays' ? `weekdays ${r.days?.join(',')}` : r.type === 'timesPerWeek' ? `${r.times}x/week` : r.type === 'everyNDays' ? `every ${r.n} days` : r.type;

function flatNumbers(obj: unknown, prefix: string, out: Record<string, number>): Record<string, number> {
  if (typeof obj === 'number') out[prefix] = obj;
  else if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) flatNumbers(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

export async function allCounters(player: Player, settings: Settings): Promise<Record<string, number>> {
  const buildings = await tycoonRepository.buildings.all();
  return mergeCounters(await statsRepository.counters(), derivedCounters(player, buildings, levelFromXp(player.xp, settings.rules.level).level));
}

type ReadFn = (args: Record<string, unknown>, ctx: ReadCtx) => Promise<unknown>;

export const READ_TOOLS: Record<string, ReadFn> = {
  async getPlayerProfile(_a, { settings: s, player: p, today }) {
    return {
      name: s.profile.nickname || p.name,
      level: p.level,
      xp: p.xp,
      coins: p.coins,
      hp: p.hp,
      energy: `${p.energy}/${p.maxEnergy}`,
      streak: p.streak.current,
      stats: p.stats,
      goals: s.profile.goals,
      body: { weightKg: s.known.weight === 'set' ? s.body.weightKg : null, heightCm: s.known.height === 'set' ? s.body.heightCm : null, goal: s.body.goal, targetWeightKg: s.body.targetWeightKg ?? null },
      targets: { nutrition: s.nutrition, steps: s.steps, waterMl: s.hydration.targetMl },
      known: profileFields(s, today).map((f) => ({ field: f.label, status: f.status, value: f.status === 'set' ? f.value : null })),
    };
  },

  async getToday(_a, { today }) {
    const { day, long } = await loadDay(today);
    const log = await statsRepository.getLog(today);
    return {
      date: today,
      quests: day.filter((q) => q.status !== 'moved').map(questRow),
      goals: long.map(questRow),
      score: log?.score ?? 0,
      load: log ? { level: log.workloadLevel, capacityMin: log.capacityMin ?? null, plannedMin: log.plannedMin ?? null } : null,
    };
  },

  async getQuests(a, { today }) {
    const date = (a.date as string) ?? today;
    const status = (a.status as string) ?? 'all';
    const qs = (await questRepository.byDate(date)).filter((q) => q.status !== 'moved' && (status === 'all' || q.status === status));
    return { date, quests: qs.map(questRow) };
  },

  async getActivities(a) {
    const q = String(a.query ?? '').toLowerCase();
    const list = (await activityRepository.all()).filter((x) => (!a.category || x.category === a.category) && (!q || x.name.toLowerCase().includes(q)));
    return {
      count: list.length,
      activities: list.slice(0, 60).map((x) => ({ id: x.id, name: x.name, category: x.category, priority: x.tier, recurrence: recurrenceText(x.recurrence as never), durationMin: x.durationMin, ...(x.preferredTime ? { time: x.preferredTime } : {}), active: x.active })),
    };
  },

  async getGoals(_a, { today }) {
    const long = await questRepository.longActive(today);
    return { goals: long.map((q) => ({ ...questRow(q), goal: q.goal, byPlayer: q.source === 'coach' })) };
  },

  async getWorkoutPlan() {
    const plan = await workoutRepository.activePlan();
    if (!plan) return { plan: null };
    const [exercises, states] = await Promise.all([workoutRepository.exercises.all(), workoutRepository.states.all()]);
    const name = new Map(exercises.map((e) => [e.id, e.name]));
    const weight = new Map(states.map((s) => [s.exerciseId, s.workingWeight]));
    return {
      plan: plan.name,
      templates: plan.templates.map((t) => ({
        id: t.id,
        name: t.name,
        weekday: t.weekday,
        estimatedMin: t.estimatedMin,
        exercises: t.exercises.map((e) => ({ exerciseId: e.exerciseId, name: name.get(e.exerciseId) ?? e.exerciseId, sets: e.sets, reps: `${e.repMin}-${e.repMax}`, restSec: e.restSec, workingWeightKg: weight.get(e.exerciseId) ?? 0 })),
      })),
    };
  },

  async getExercises(a) {
    const q = String(a.query ?? '').toLowerCase();
    const list = (await workoutRepository.exercises.all()).filter((e) => !q || e.name.toLowerCase().includes(q) || e.id.includes(q));
    return { exercises: list.slice(0, 40).map((e) => ({ id: e.id, name: e.name, category: e.category, equipment: e.equipment, muscles: e.muscles.map((m) => m.muscle) })) };
  },

  async getWorkoutHistory(a) {
    const sessions = await workoutRepository.recentSessions(Number(a.limit ?? 8));
    return { sessions: sessions.map((s) => ({ date: s.date, name: s.name, kind: s.kind, status: s.status, ...sessionStats(s) })) };
  },

  async getNutritionToday(_a, { settings: s, today }) {
    const [entries, meals] = await Promise.all([statsRepository.metricsByDate(today), statsRepository.mealsByDate(today)]);
    const sum = (t: string) => Math.round(entries.filter((e) => e.type === t).reduce((x, e) => x + e.value, 0));
    return {
      totals: { calories: sum('calories'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), waterMl: sum('water') },
      targets: { ...s.nutrition, waterMl: s.hydration.targetMl },
      meals: meals.map((m) => ({ name: m.name, kcal: m.kcal, protein: m.protein, source: m.source === 'ai' ? 'AI estimate' : m.source })),
    };
  },

  async getNutritionHistory(a, { today }) {
    const days = Number(a.days ?? 7);
    const logs = await statsRepository.logs(shiftDate(today, -(days - 1)), today);
    return { days: logs.map((l) => ({ date: l.date, calories: l.metrics.calories ?? 0, protein: l.metrics.protein ?? 0, waterMl: l.metrics.water ?? 0 })) };
  },

  async getSteps(a, { settings: s, today }) {
    const days = Number(a.days ?? 7);
    const logs = await statsRepository.logs(shiftDate(today, -(days - 1)), today);
    return { targets: s.steps, days: logs.map((l) => ({ date: l.date, steps: l.metrics.steps ?? 0 })) };
  },

  async getCalendar(a) {
    const from = String(a.from);
    const to = String(a.to);
    if (to < from || daysBetween(from, to) > 31) throw new ToolError('Use a range of at most 31 days (from ≤ to).');
    const logs = await statsRepository.logs(from, to);
    return { days: logs.map((l) => ({ date: l.date, score: l.score, success: l.success, core: `${l.core.done}/${l.core.total}`, important: `${l.important.done}/${l.important.total}`, optional: `${l.optional.done}/${l.optional.total}`, workouts: l.workouts })) };
  },

  async getRoutines() {
    const [routines, acts] = await Promise.all([routineRepository.all(), activityRepository.all()]);
    const name = new Map(acts.map((x) => [x.id, x.name]));
    return { routines: routines.map((r) => ({ id: r.id, name: r.name, kind: r.kind, active: r.active, startTime: r.startTime ?? null, activities: r.activityIds.map((id) => ({ id, name: name.get(id) ?? '(deleted)' })) })) };
  },

  async getStreaks(_a, { player: p }) {
    const counters = await statsRepository.counters();
    const acts = await activityRepository.all();
    const name = new Map(acts.map((x) => [x.id, x.name]));
    const perActivity = Object.entries(counters)
      .filter(([k, v]) => k.startsWith('actStreak.') && v > 1)
      .map(([k, v]) => ({ activity: name.get(k.slice(10)) ?? k.slice(10), best: v }))
      .sort((x, y) => y.best - x.best)
      .slice(0, 10);
    return { daily: { current: p.streak.current, longest: p.streak.longest }, weekly: p.streak.weekly, freezes: p.inventory.streakFreeze, revives: p.inventory.streakRevive, bestActivityStreaks: perActivity };
  },

  async getAchievements(a) {
    const filter = (a.filter as string) ?? 'all';
    const list = (await achievementRepository.all()).filter((x) => filter === 'all' || (filter === 'unlocked' ? !!x.unlockedAt : filter === 'locked' ? !x.unlockedAt : x.id.startsWith('custom_')));
    return {
      count: list.length,
      achievements: list.slice(0, 60).map((x) => ({ id: x.id, name: x.hidden && !x.unlockedAt ? '???' : x.name, description: x.hidden && !x.unlockedAt ? 'Hidden' : x.description, condition: x.condition, xp: x.xp, coins: x.coins, unlocked: !!x.unlockedAt, custom: x.id.startsWith('custom_') })),
    };
  },

  async getAchievementCounters(_a, { player, settings }) {
    const values = await allCounters(player, settings);
    return {
      counters: COUNTER_CATALOG.map((c) => ({ ...c, current: values[c.key] ?? 0 })),
      patterns: ['cat.<category> = quests completed in that category', 'actStreak.<activityId> = best completion streak of one activity', 'stats.<stat> = stat points'],
    };
  },

  async getTycoonWorld(_a, { player }) {
    const b = await tycoonRepository.buildings.all();
    return {
      coins: player.coins,
      homeLevel: homeLevel(b),
      rooms: b.map((x) => ({ id: x.id, name: x.name, level: x.level, maxLevel: x.maxLevel, nextCost: x.level < x.maxLevel ? buildingCost(x, x.level + 1) : null, unlockLevel: x.unlockLevel, baseCost: x.baseCost, costGrowth: x.costGrowth })),
    };
  },

  async getEnergy(_a, { player: p }) {
    return { energy: p.energy, maxEnergy: p.maxEnergy, hp: p.hp, recoveryMode: p.recoveryMode, effects: p.effects.map((e) => ({ label: e.label, description: e.description, until: e.expiresOn })), info: 'Energy starts each day from sleep and rest; quests cost energy, recovery activities restore it. HP drops when core quests are missed and recovers by completing them.' };
  },

  async getStats(_a, { player: p }) {
    return { stats: p.stats, level: p.level, lifetime: p.lifetime };
  },

  async getSchedule(_a, { settings: s, today }) {
    const sch = activeSchedule(s.work, today);
    const temporary = await upcomingTemporary(today, 30);
    return {
      workStatus: s.work.status,
      regularWeek: s.work.status === 'set' && sch ? summarizeSchedule(sch.days) : null,
      variable: sch?.variable ?? false,
      upcomingVersions: upcomingSchedules(s.work, today).map((u) => ({ from: u.effectiveFrom, week: summarizeSchedule(u.days) })),
      oneOffDays: temporary.map((p) => ({ date: p.date, status: p.workStatus, start: p.workStart ?? p.work?.start ?? null, end: p.workEnd ?? p.work?.end ?? null })),
      exceptions: s.exceptions.filter((e) => !e.to || e.to >= today).map((e) => ({ kind: e.kind, from: e.from, to: e.to ?? null, note: e.note ?? null })),
      loadMode: s.load.mode,
      wake: s.known.wake === 'set' ? s.schedule.wake : null,
      sleep: s.known.sleep === 'set' ? s.schedule.sleep : null,
    };
  },

  async getDailyScore(a, { today }) {
    const date = (a.date as string) ?? today;
    const log = await statsRepository.getLog(date);
    if (!log) return { date, score: null, note: 'No data for this date.' };
    return { date, score: log.score, success: log.success, components: log.breakdown?.components.map((c) => ({ key: c.key, weight: c.weight, ratio: c.ratio === null ? null : Math.round(c.ratio * 100) / 100 })), bonus: log.breakdown?.bonus ?? 0 };
  },

  async getWeeklySummary(_a, { today }) {
    const w = await weeklyReview(today);
    return { from: w.from, to: w.to, avgScore: w.avgScore, prevAvgScore: w.prevAvgScore, xp: w.xp, coins: w.coins, workouts: w.workouts, avgSteps: w.avgSteps, successDays: Math.round(w.consistency * 7), coreRate: w.coreRate === null ? null : Math.round(w.coreRate * 100), strongest: w.strongest ?? null, weakest: w.weakest ?? null };
  },

  async getGameRules(a, { settings }) {
    const section = (a.section as keyof Settings['rules']) ?? undefined;
    const sections = section ? [section] : (['score', 'xp', 'coins', 'energy', 'hp', 'penalties', 'streak'] as const);
    const out: Record<string, number> = {};
    for (const k of sections) flatNumbers(settings.rules[k], k, out);
    return { rules: out, note: 'Pass these paths to updateGameRules.' };
  },

  async getDailyContext() {
    const snap = await contextSnapshot();
    if (!snap) throw new ToolError('Daily context is not available yet.');
    return dailyContextSummary(snap);
  },

  async getChangeHistory(a) {
    const list = await recentChanges(Number(a.limit ?? 10));
    return { changes: list.map((c) => ({ id: c.id, when: new Date(c.ts).toISOString(), tool: c.tool, summary: c.summary, undone: !!c.undoneAt, undoable: !!c.undo && !c.undoneAt })) };
  },
};

export async function readContext(): Promise<ReadCtx> {
  const [settings, player] = await Promise.all([settingsRepository.get(), playerRepository.get()]);
  if (!settings || !player) throw new ToolError('The game is not initialised yet.');
  return { settings, player, today: clock.today() };
}
