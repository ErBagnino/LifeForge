import { CATEGORY_INFO } from '@/data/categories';
import type { ConfigChange } from '@/domain/coachAssistant';
import { computeQuestValues } from '@/domain/rewards';
import { buildingCost } from '@/domain/tycoon';
import {
  achievementRepository,
  activityRepository,
  questRepository,
  routineRepository,
  statsRepository,
  tycoonRepository,
  workoutRepository,
} from '@/repositories';
import type { Achievement, Activity, ActivityCategory, Difficulty, Quest, QuestGoal, QuestTier, Recurrence, Routine, Settings, TimeHM, WorkDayEntry } from '@/types';
import { dateTimeToTs, daysBetween, formatDate } from '@/utils/date';
import { clock } from '../../clock';
import { uid } from '@/utils/id';
import { roundTo } from '@/utils/math';
import { deleteActivity, deleteRoutine, saveActivity, saveRoutine, saveSettings, savePlan } from '../../adminService';
import { applyChanges, describeChanges } from '../../coachService';
import type { GameEvent } from '../../events';
import { addQuests, completeQuest, deleteQuest, skipQuest, updateQuestFields } from '../../game/questService';
import { manualQuest } from '../../game/questFactory';
import { logMeal, logMetric } from '../../metricsService';
import { MEAL_INFO, mealTypeAt, type MealType } from '@/config/meals';
import { RESET_INFO, RESET_PHRASE, runReset, type ResetKind } from '../../resetService';
import { setWorkingWeight } from '../../workoutService';
import { isKnownCounter } from './counters';
import { allCounters, ToolError, type ReadCtx } from './readTools';

/**
 * Write tools. Each one validates its (already zod-checked) arguments against the real
 * game data and returns a Plan: a before→after preview plus an `apply` function that
 * goes through the normal services (the AI never touches the database directly).
 */

export interface PreviewLine {
  label: string;
  before?: string;
  after?: string;
}

export interface Plan {
  title: string;
  lines: PreviewLine[];
  warnings: string[];
  /** Typed phrase required before applying (full reset). */
  confirmPhrase?: string;
  /** How the change can be undone. */
  /** meal / metric: undone through deleteMeal / deleteMetric, so totals, quests and rewards stay consistent. */
  undo: 'snapshot' | 'uncomplete' | 'meal' | 'metric' | 'none';
  apply(): Promise<{ message: string; data?: Record<string, unknown>; events: GameEvent[] }>;
}

type A = Record<string, unknown>;
type PlanFn = (args: A, ctx: ReadCtx) => Promise<Plan>;

const TIER_LABEL: Record<QuestTier, string> = { core: 'Core', important: 'Important', optional: 'Optional' };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (d: string) => formatDate(d, 'EEE d MMM');
const str = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30) || 'item';
}

function diffLines(before: A, after: A, labels: Record<string, string>): PreviewLine[] {
  return Object.keys(labels)
    .filter((k) => after[k] !== undefined && JSON.stringify(after[k]) !== JSON.stringify(before[k]))
    .map((k) => ({ label: labels[k], before: str(before[k]), after: str(after[k]) }));
}

function requireFuture(date: string, today: string): void {
  if (date < today) throw new ToolError(`${date} is in the past. Use today (${today}) or a later date.`);
  if (daysBetween(today, date) > 366) throw new ToolError('Dates more than a year ahead are not supported.');
}

async function mustQuest(id: string): Promise<Quest> {
  const q = await questRepository.get(id);
  if (!q || q.status === 'moved') throw new ToolError(`Quest "${id}" not found. Call getQuests or getToday for valid ids.`);
  return q;
}

function recurrenceFrom(r: A): Recurrence {
  switch (r.type) {
    case 'daily':
      return { type: 'daily' };
    case 'weekdays': {
      const days = [...new Set((r.days as number[] | undefined) ?? [])].sort();
      if (!days.length) throw new ToolError('recurrence.days is required for type "weekdays".');
      return { type: 'weekdays', days };
    }
    case 'timesPerWeek':
      if (!r.times) throw new ToolError('recurrence.times is required for type "timesPerWeek".');
      return { type: 'timesPerWeek', times: Number(r.times) };
    case 'everyNDays':
      if (!r.n) throw new ToolError('recurrence.n is required for type "everyNDays".');
      return { type: 'everyNDays', n: Number(r.n) };
    default:
      throw new ToolError('Unknown recurrence type.');
  }
}

export function recurrenceLabel(r: Recurrence): string {
  switch (r.type) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return `Every ${r.days.map((d) => WD[d]).join(', ')}`;
    case 'timesPerWeek':
      return `${r.times}× per week`;
    case 'everyNDays':
      return `Every ${r.n} days`;
    default:
      return 'On demand';
  }
}

// ——— One-time quests ———

function oneTimeQuest(a: A, ctx: ReadCtx, kind: Quest['kind'], tierDefault: QuestTier, difficulty: Difficulty = 2): Quest {
  const date = String(a.date);
  requireFuture(date, ctx.today);
  const category = a.category as ActivityCategory;
  const tier = (a.priority as QuestTier) ?? tierDefault;
  const base = manualQuest(
    { settings: ctx.settings, level: ctx.player.level, date, now: Date.now() },
    { title: String(a.title), icon: (a.icon as string) || CATEGORY_INFO[category].icon, category, difficulty, durationMin: Number(a.durationMin), tier },
  );
  return {
    ...base,
    kind,
    baseTier: tier,
    scheduledTime: a.time as TimeHM | undefined,
    description: (a.description as string) ?? undefined,
    notes: (a.notes as string) ?? undefined,
    xp: a.xp !== undefined ? Number(a.xp) : base.xp,
    coins: a.coins !== undefined ? Number(a.coins) : base.coins,
    energyCost: a.energyCost !== undefined ? Number(a.energyCost) : base.energyCost,
    source: 'coach',
    reason: kind === 'challenge' ? 'Challenge set with the Coach' : 'One-time activity set with the Coach',
  };
}

function oneTimePlan(q: Quest, ctx: ReadCtx, label: string): Plan {
  const warnings: string[] = [];
  if (q.date === ctx.today && q.scheduledTime && q.scheduledTime < new Date().toTimeString().slice(0, 5)) warnings.push(`${q.scheduledTime} has already passed today.`);
  return {
    title: `${label}: ${q.title}`,
    lines: [
      { label: 'Type', after: q.kind === 'challenge' ? 'Challenge · one time only' : 'One time only (not recurring)' },
      { label: 'Date', after: fmtDate(q.date) },
      ...(q.scheduledTime ? [{ label: 'Time', after: q.scheduledTime }] : []),
      { label: 'Duration', after: `${q.durationMin} min` },
      { label: 'Priority', after: TIER_LABEL[q.tier] },
      { label: 'Reward', after: `+${q.xp} XP · +${q.coins} coins` },
    ],
    warnings,
    undo: 'snapshot',
    async apply() {
      const r = await addQuests([q]);
      return { message: `Added "${q.title}" on ${fmtDate(q.date)} (one time).`, data: { questId: q.id, date: q.date }, events: r.events };
    },
  };
}

// ——— Settings helpers ———

async function settingsPlan(title: string, _ctx: ReadCtx, next: Settings, lines: PreviewLine[], warnings: string[] = [], after?: () => Promise<GameEvent[]>): Promise<Plan> {
  if (!lines.length) throw new ToolError('Nothing would change: the values are already set.');
  return {
    title,
    lines,
    warnings,
    undo: 'snapshot',
    async apply() {
      await saveSettings(next);
      const events = after ? await after() : [];
      return { message: `${title}: ${lines.map((l) => `${l.label} ${l.after}`).join(', ')}.`, events };
    },
  };
}

function configPlan(title: string, changes: ConfigChange[], ctx: ReadCtx, warnings: string[] = []): Plan {
  return {
    title,
    lines: describeChanges(changes, ctx.today).map((l) => ({ label: l })),
    warnings,
    undo: 'snapshot',
    async apply() {
      const r = await applyChanges(changes);
      return { message: `${title}: done.`, events: r.events };
    },
  };
}

function goalFrom(a: A): QuestGoal {
  const target = Number(a.target);
  switch (a.type) {
    case 'workouts':
      return { type: 'workouts', count: target };
    case 'metricSum':
      if (!a.metric) throw new ToolError('metric is required for metricSum goals.');
      return { type: 'metricSum', metric: a.metric as never, target };
    case 'metricDays':
      if (!a.metric) throw new ToolError('metric is required for metricDays goals.');
      return { type: 'metricDays', metric: a.metric as never, days: target };
    case 'completeCount':
      return { type: 'completeCount', count: target, category: a.category as ActivityCategory | undefined };
    case 'scoreDays':
      if (!a.minScore) throw new ToolError('minScore is required for scoreDays goals.');
      return { type: 'scoreDays', minScore: Number(a.minScore), days: target };
    case 'perfectCoreDays':
      return { type: 'perfectCoreDays', days: target };
    default:
      throw new ToolError('Unknown goal type.');
  }
}

function goalText(g: QuestGoal): string {
  switch (g.type) {
    case 'workouts':
      return `${g.count} workouts`;
    case 'metricSum':
      return `${g.target} ${g.metric} in total`;
    case 'metricDays':
      return `${g.metric} target on ${g.days} days`;
    case 'completeCount':
      return `${g.count} quests${g.category ? ` (${g.category})` : ''}`;
    case 'scoreDays':
      return `score ≥ ${g.minScore} on ${g.days} days`;
    case 'perfectCoreDays':
      return `${g.days} perfect-core days`;
    default:
      return g.type;
  }
}

async function findGoal(id: string): Promise<Quest> {
  const q = await questRepository.get(id);
  if (!q || !q.goal || !q.endDate) throw new ToolError(`Goal "${id}" not found. Call getGoals for valid ids.`);
  return q;
}

async function findAchievement(id: string): Promise<Achievement> {
  const a = await achievementRepository.get(id);
  if (!a) throw new ToolError(`Achievement "${id}" not found. Call getAchievements for valid ids.`);
  return a;
}

async function activePlanOrThrow() {
  const plan = await workoutRepository.activePlan();
  if (!plan) throw new ToolError('There is no active workout plan.');
  return plan;
}

function templateOrThrow(plan: Awaited<ReturnType<typeof activePlanOrThrow>>, id: string) {
  const t = plan.templates.find((x) => x.id === id);
  if (!t) throw new ToolError(`Workout "${id}" not found. Call getWorkoutPlan for valid template ids.`);
  return t;
}

const RESET_TOOL: Record<string, ResetKind> = {
  resetToday: 'today',
  resetWeek: 'week',
  resetWorkoutHistory: 'workouts',
  resetNutritionHistory: 'nutrition',
  resetGameProgress: 'game',
  resetAllData: 'all',
};

function resetPlan(kind: ResetKind): Plan {
  const info = RESET_INFO[kind];
  return {
    title: info.title,
    lines: [...info.deletes.map((d) => ({ label: `Deletes: ${d}` })), ...info.keeps.map((k) => ({ label: `Keeps: ${k}` }))],
    warnings: ['This cannot be undone. Export a backup first (Settings → Data) if you might want it back.'],
    confirmPhrase: kind === 'all' ? RESET_PHRASE : undefined,
    undo: 'none',
    async apply() {
      const r = await runReset(kind);
      return { message: `${info.title}: done.`, data: { reloadRequired: kind === 'all' }, events: r.events };
    },
  };
}

// ——— Tool table ———

export const WRITE_TOOLS: Record<string, PlanFn> = {
  async scheduleOneTimeActivity(a, ctx) {
    return oneTimePlan(oneTimeQuest(a, ctx, 'manual', 'important'), ctx, 'One-time activity');
  },

  async createQuest(a, ctx) {
    const challenge = a.type === 'challenge';
    return oneTimePlan(oneTimeQuest(a, ctx, challenge ? 'challenge' : 'manual', challenge ? 'optional' : 'important'), ctx, challenge ? 'New challenge' : 'New quest');
  },

  async createChallenge(a, ctx) {
    const q = oneTimeQuest({ ...a, priority: 'optional' }, ctx, 'challenge', 'optional', Number(a.difficulty) as Difficulty);
    const plan = oneTimePlan(q, ctx, 'New challenge');
    if (q.date === ctx.today) {
      const log = await statsRepository.getLog(ctx.today);
      if (log?.capacityMin && log.plannedMin !== undefined && log.plannedMin + q.durationMin > log.capacityMin) plan.warnings.push(`Today has about ${Math.max(0, log.capacityMin - log.plannedMin)} free minutes: a ${q.durationMin}-min challenge may not fit.`);
      if (ctx.player.energy < 30 && q.difficulty >= 4) plan.warnings.push('Energy is low today: a hard challenge may be too much.');
    }
    return plan;
  },

  async updateQuest(a, ctx) {
    const q = await mustQuest(String(a.questId));
    if (q.status === 'completed') throw new ToolError('Completed quests can’t be edited.');
    const patch = { title: a.title, date: a.date, scheduledTime: a.time, durationMin: a.durationMin, tier: a.priority, xp: a.xp, coins: a.coins, description: a.notes } as A;
    const before = { title: q.title, date: q.date, scheduledTime: q.scheduledTime, durationMin: q.durationMin, tier: q.tier, xp: q.xp, coins: q.coins, description: q.description } as A;
    const lines = diffLines(before, patch, { title: 'Title', date: 'Date', scheduledTime: 'Time', durationMin: 'Minutes', tier: 'Priority', xp: 'XP', coins: 'Coins', description: 'Notes' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    if (patch.date) requireFuture(String(patch.date), ctx.today);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return {
      title: `Edit quest: ${q.title}`,
      lines,
      warnings: q.activityId && patch.date ? ['Only this occurrence moves; the recurring activity is unchanged.'] : [],
      undo: 'snapshot',
      async apply() {
        const r = await updateQuestFields(q.id, clean);
        return { message: `Updated "${q.title}".`, events: r.events };
      },
    };
  },

  async deleteQuest(a) {
    const q = await mustQuest(String(a.questId));
    if (q.status === 'completed') throw new ToolError('Completed quests can’t be deleted (their rewards are already granted).');
    return {
      title: `Delete quest: ${q.title}`,
      lines: [{ label: 'Quest', before: `${q.title} · ${fmtDate(q.date)}`, after: 'deleted' }],
      warnings: q.activityId ? ['Only this occurrence is deleted; the recurring activity stays. Use deleteActivity to stop it for good.'] : [],
      undo: 'snapshot',
      async apply() {
        const r = await deleteQuest(q.id);
        return { message: `Deleted "${q.title}".`, events: r.events };
      },
    };
  },

  async rescheduleActivity(a, ctx) {
    const q = await mustQuest(String(a.questId));
    if (q.status === 'completed') throw new ToolError('This quest is already completed.');
    if (!a.date && !a.time) throw new ToolError('Give a new date and/or time.');
    if (a.date) requireFuture(String(a.date), ctx.today);
    const lines = diffLines({ date: q.date, time: q.scheduledTime }, { date: a.date, time: a.time }, { date: 'Date', time: 'Time' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    return {
      title: `Reschedule: ${q.title}`,
      lines,
      warnings: [],
      undo: 'snapshot',
      async apply() {
        const r = await updateQuestFields(q.id, { ...(a.date ? { date: String(a.date) } : {}), ...(a.time ? { scheduledTime: String(a.time) } : {}) });
        return { message: `Moved "${q.title}" to ${a.date ? fmtDate(String(a.date)) : ''}${a.time ? ` ${a.time}` : ''}.`.replace(' .', '.'), events: r.events };
      },
    };
  },

  async completeQuest(a, ctx) {
    const q = await mustQuest(String(a.questId));
    if (q.status === 'completed') throw new ToolError('Already completed.');
    if (q.date !== ctx.today && !q.endDate) throw new ToolError('Only today’s quests can be completed.');
    return {
      title: `Complete: ${q.title}`,
      lines: [{ label: 'Status', before: q.status, after: 'completed' }],
      warnings: [],
      undo: 'uncomplete',
      async apply() {
        const r = await completeQuest(q.id);
        return { message: `Completed "${q.title}".`, data: { questId: q.id }, events: r.events };
      },
    };
  },

  async skipQuest(a) {
    const q = await mustQuest(String(a.questId));
    if (q.status !== 'pending') throw new ToolError(`The quest is ${q.status}, not pending.`);
    return {
      title: `Skip: ${q.title}`,
      lines: [{ label: 'Status', before: 'pending', after: 'skipped' }],
      warnings: q.tier === 'core' ? ['This is a core quest: skipping it affects today’s score.'] : [],
      undo: 'snapshot',
      async apply() {
        const r = await skipQuest(q.id, (a.reason as never) ?? 'other');
        return { message: `Skipped "${q.title}".`, events: r.events };
      },
    };
  },

  // ——— Food & water log ———

  async logFood(a, ctx) {
    const mealType = (a.mealType as MealType | undefined) ?? mealTypeAt(new Date(a.time ? dateTimeToTs(ctx.today, String(a.time), ctx.settings.dayStartHour) : clock.now()));
    const ts = a.time ? dateTimeToTs(ctx.today, String(a.time), ctx.settings.dayStartHour) : undefined;
    const v = { kcal: Math.round(Number(a.kcal)), protein: Math.round(Number(a.protein)), carbs: Math.round(Number(a.carbs)), fat: Math.round(Number(a.fat)) };
    if (!v.kcal && !v.protein && !v.carbs && !v.fat) throw new ToolError('Give at least calories or one macro.');
    const name = String(a.name);
    return {
      title: `Log food: ${name}`,
      lines: [
        { label: 'Meal', after: `${MEAL_INFO[mealType].label}${a.time ? ` · ${a.time}` : ''}` },
        { label: 'Calories', after: `~${v.kcal} kcal` },
        { label: 'Protein · Carbs · Fat', after: `~${v.protein} · ${v.carbs} · ${v.fat} g` },
      ],
      warnings: ['Estimated values — you can edit or delete the meal in Nutrition.'],
      undo: 'meal',
      async apply() {
        const r = await logMeal({ name, mealType, ts, items: [{ name, ...v }], ...v, source: 'ai' });
        return { message: `Logged "${name}" (~${v.kcal} kcal) as ${MEAL_INFO[mealType].label}.`, data: { ...v, mealType, mealId: r.mealId }, events: r.events };
      },
    };
  },

  async logWater(a, ctx) {
    const ml = Number(a.ml);
    const before = ctx.today === clock.today() ? ((await statsRepository.metricsByDate(ctx.today)).filter((m) => m.type === 'water').reduce((s, m) => s + m.value, 0)) : 0;
    return {
      title: `Log water: ${ml} ml`,
      lines: [{ label: 'Water today', before: `${(before / 1000).toFixed(2)} L`, after: `${((before + ml) / 1000).toFixed(2)} L` }],
      warnings: [],
      undo: 'metric',
      async apply() {
        const r = await logMetric('water', ml);
        return { message: `Logged ${ml} ml of water.`, data: { ml, metricId: r.entryId }, events: r.events };
      },
    };
  },

  // ——— Recurring activities ———

  async createActivity(a) {
    const recurrence = recurrenceFrom(a.recurrence as A);
    const category = a.category as ActivityCategory;
    const tier = a.priority as QuestTier;
    const existing = await activityRepository.all();
    if (existing.some((x) => x.name.toLowerCase() === String(a.name).toLowerCase() && x.active)) throw new ToolError(`An active activity called "${a.name}" already exists. Use updateActivity instead.`);
    let id = `coach_${slug(String(a.name))}`;
    if (existing.some((x) => x.id === id)) id = `${id}_${uid().slice(-4)}`;
    const now = Date.now();
    const activity: Activity = {
      id,
      name: String(a.name),
      icon: (a.icon as string) || CATEGORY_INFO[category].icon,
      category,
      description: a.description as string | undefined,
      tier,
      importance: tier === 'core' ? 5 : tier === 'important' ? 4 : 2,
      difficulty: (Number(a.difficulty ?? 2) as Difficulty),
      recurrence,
      timeOfDay: 'anytime',
      preferredTime: a.preferredTime as TimeHM | undefined,
      durationMin: Number(a.durationMin),
      quantity: a.quantity as number | undefined,
      unit: a.unit as string | undefined,
      baseXp: a.xp as number | undefined,
      baseCoins: a.coins as number | undefined,
      stats: { ...CATEGORY_INFO[category].stats },
      adaptive: false,
      active: true,
      streakEligible: true,
      generatorEligible: false,
      userCreated: true,
      aiImported: false,
      createdAt: now,
      updatedAt: now,
    };
    return {
      title: `New recurring activity: ${activity.name}`,
      lines: [
        { label: 'Repeats', after: recurrenceLabel(recurrence) },
        { label: 'Duration', after: `${activity.durationMin} min` },
        ...(activity.preferredTime ? [{ label: 'Time', after: activity.preferredTime }] : []),
        { label: 'Priority', after: TIER_LABEL[tier] },
        { label: 'Category', after: CATEGORY_INFO[category].label },
      ],
      warnings: tier === 'core' ? ['Core quests count most for the daily score. Keep core quests few.'] : [],
      undo: 'snapshot',
      async apply() {
        const r = await saveActivity(activity, { isNew: true });
        return { message: `Created recurring activity "${activity.name}" (${recurrenceLabel(recurrence).toLowerCase()}).`, data: { activityId: id }, events: r.events };
      },
    };
  },

  async updateActivity(a) {
    const act = await activityRepository.get(String(a.activityId));
    if (!act) throw new ToolError(`Activity "${a.activityId}" not found. Call getActivities for valid ids.`);
    const next: Activity = { ...act };
    if (a.name !== undefined) next.name = String(a.name);
    if (a.category !== undefined) next.category = a.category as ActivityCategory;
    if (a.priority !== undefined) {
      next.tier = a.priority as QuestTier;
      next.importance = next.tier === 'core' ? 5 : next.tier === 'important' ? 4 : 2;
    }
    if (a.recurrence !== undefined) next.recurrence = recurrenceFrom(a.recurrence as A);
    if (a.durationMin !== undefined) next.durationMin = Number(a.durationMin);
    if (a.preferredTime !== undefined) next.preferredTime = String(a.preferredTime);
    if (a.difficulty !== undefined) next.difficulty = Number(a.difficulty) as Difficulty;
    if (a.active !== undefined) next.active = !!a.active;
    if (a.description !== undefined) next.description = String(a.description);
    if (a.xp !== undefined) next.baseXp = Number(a.xp);
    if (a.coins !== undefined) next.baseCoins = Number(a.coins);
    const view = (x: Activity) => ({ name: x.name, category: x.category, tier: x.tier, recurrence: recurrenceLabel(x.recurrence), durationMin: x.durationMin, preferredTime: x.preferredTime, difficulty: x.difficulty, active: x.active ? 'yes' : 'no', description: x.description, baseXp: x.baseXp ?? 'auto', baseCoins: x.baseCoins ?? 'auto' });
    const lines = diffLines(view(act), view(next), { name: 'Name', category: 'Category', tier: 'Priority', recurrence: 'Repeats', durationMin: 'Minutes', preferredTime: 'Time', difficulty: 'Difficulty', active: 'Active', description: 'Description', baseXp: 'XP', baseCoins: 'Coins' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    return {
      title: `Edit activity: ${act.name}`,
      lines,
      warnings: [],
      undo: 'snapshot',
      async apply() {
        const r = await saveActivity(next);
        return { message: `Updated "${next.name}".`, events: r.events };
      },
    };
  },

  async deleteActivity(a) {
    const act = await activityRepository.get(String(a.activityId));
    if (!act) throw new ToolError(`Activity "${a.activityId}" not found.`);
    return {
      title: `Delete activity: ${act.name}`,
      lines: [{ label: 'Activity', before: `${act.name} · ${recurrenceLabel(act.recurrence)}`, after: 'deleted' }],
      warnings: ['Today’s pending quest for it is removed; completed history stays.'],
      undo: 'snapshot',
      async apply() {
        await deleteActivity(act.id);
        return { message: `Deleted "${act.name}".`, events: [] };
      },
    };
  },

  async createRoutine(a) {
    const ids = a.activityIds as string[];
    const acts = await activityRepository.all();
    const missing = ids.filter((id) => !acts.some((x) => x.id === id));
    if (missing.length) throw new ToolError(`Unknown activity ids: ${missing.join(', ')}. Call getActivities first.`);
    const kind = a.kind as Routine['kind'];
    const now = Date.now();
    const routine: Routine = {
      id: `routine_${slug(String(a.name))}_${uid().slice(-4)}`,
      name: String(a.name),
      icon: (a.icon as string) || (kind === 'morning' ? '🌅' : kind === 'night' ? '🌙' : kind === 'workout' ? '🏋️' : '✨'),
      kind,
      activityIds: ids,
      timeOfDay: kind === 'morning' ? 'morning' : kind === 'night' ? 'night' : 'anytime',
      startTime: a.startTime as TimeHM | undefined,
      active: true,
      bonusXp: Number(a.bonusXp ?? 20),
      bonusCoins: 5,
      createdAt: now,
      updatedAt: now,
    };
    return {
      title: `New routine: ${routine.name}`,
      lines: [{ label: 'Activities', after: ids.map((id) => acts.find((x) => x.id === id)!.name).join(', ') }, ...(routine.startTime ? [{ label: 'Start', after: routine.startTime }] : []), { label: 'Bonus', after: `+${routine.bonusXp} XP when all are done` }],
      warnings: [],
      undo: 'snapshot',
      async apply() {
        await saveRoutine(routine);
        return { message: `Created routine "${routine.name}".`, data: { routineId: routine.id }, events: [] };
      },
    };
  },

  async updateRoutine(a) {
    const r = await routineRepository.get(String(a.routineId));
    if (!r) throw new ToolError(`Routine "${a.routineId}" not found. Call getRoutines.`);
    const acts = await activityRepository.all();
    const next: Routine = { ...r, ...(a.name ? { name: String(a.name) } : {}), ...(a.activityIds ? { activityIds: a.activityIds as string[] } : {}), ...(a.startTime ? { startTime: String(a.startTime) } : {}), ...(a.active !== undefined ? { active: !!a.active } : {}) };
    const missing = next.activityIds.filter((id) => !acts.some((x) => x.id === id));
    if (missing.length) throw new ToolError(`Unknown activity ids: ${missing.join(', ')}.`);
    const names = (ids: string[]) => ids.map((id) => acts.find((x) => x.id === id)?.name ?? id).join(', ');
    const lines = diffLines({ name: r.name, acts: names(r.activityIds), startTime: r.startTime, active: r.active ? 'yes' : 'no' }, { name: next.name, acts: names(next.activityIds), startTime: next.startTime, active: next.active ? 'yes' : 'no' }, { name: 'Name', acts: 'Activities', startTime: 'Start', active: 'Active' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    return {
      title: `Edit routine: ${r.name}`,
      lines,
      warnings: [],
      undo: 'snapshot',
      async apply() {
        await saveRoutine(next);
        return { message: `Updated routine "${next.name}".`, events: [] };
      },
    };
  },

  async deleteRoutine(a) {
    const r = await routineRepository.get(String(a.routineId));
    if (!r) throw new ToolError(`Routine "${a.routineId}" not found.`);
    return {
      title: `Delete routine: ${r.name}`,
      lines: [{ label: 'Routine', before: r.name, after: 'deleted' }],
      warnings: ['Its activities stay in the library.'],
      undo: 'snapshot',
      async apply() {
        await deleteRoutine(r.id);
        return { message: `Deleted routine "${r.name}".`, events: [] };
      },
    };
  },

  // ——— Goals & achievements ———

  async createGoal(a, ctx) {
    const goal = goalFrom(a);
    const start = (a.startDate as string) ?? ctx.today;
    const end = String(a.endDate);
    requireFuture(end, ctx.today);
    if (end < start) throw new ToolError('endDate must be after startDate.');
    const days = daysBetween(start, end) + 1;
    if (days > 120) throw new ToolError('Goals can last at most 120 days.');
    const rules = ctx.settings.rules;
    const values = computeQuestValues({ difficulty: 3, durationMin: rules.xp.refDurationByDifficulty[3], importance: 3, rarity: 'rare', category: (a.category as ActivityCategory) ?? 'general' }, ctx.player.level, rules);
    const mult = Math.max(1.5, Math.min(6, days / 5));
    const now = Date.now();
    const category = (a.category as ActivityCategory) ?? 'general';
    const q: Quest = {
      id: uid('q_'),
      date: start,
      endDate: end,
      kind: days <= 7 ? 'weekly' : 'boss',
      tier: 'optional',
      title: String(a.title),
      icon: '🎯',
      category,
      difficulty: 3,
      rarity: 'rare',
      xp: a.xp !== undefined ? Number(a.xp) : roundTo(values.xp * mult, 5),
      coins: a.coins !== undefined ? Number(a.coins) : Math.round(values.coins * mult),
      energyCost: 0,
      stats: { ...CATEGORY_INFO[category].stats },
      progress: 0,
      goal,
      durationMin: 0,
      status: 'pending',
      snoozeCount: 0,
      rescheduleCount: 0,
      source: 'coach',
      reason: 'Goal set with the Coach',
      createdAt: now,
      updatedAt: now,
    };
    return {
      title: `New goal: ${q.title}`,
      lines: [
        { label: 'Target', after: goalText(goal) },
        { label: 'Period', after: `${fmtDate(start)} → ${fmtDate(end)} (${days} days)` },
        { label: 'Reward', after: `+${q.xp} XP · +${q.coins} coins` },
      ],
      warnings: [],
      undo: 'snapshot',
      async apply() {
        const r = await addQuests([q]);
        return { message: `Goal "${q.title}" created until ${fmtDate(end)}.`, data: { goalId: q.id }, events: r.events };
      },
    };
  },

  async updateGoal(a, ctx) {
    const q = await findGoal(String(a.goalId));
    if (q.status !== 'pending') throw new ToolError(`This goal is ${q.status}.`);
    const next: Quest = { ...q };
    if (a.title) next.title = String(a.title);
    if (a.endDate) {
      requireFuture(String(a.endDate), ctx.today);
      next.endDate = String(a.endDate);
    }
    if (a.xp !== undefined) next.xp = Number(a.xp);
    if (a.coins !== undefined) next.coins = Number(a.coins);
    if (a.target !== undefined && next.goal) {
      const t = Number(a.target);
      const g = { ...next.goal } as Record<string, unknown>;
      if ('count' in g) g.count = t;
      else if ('days' in g) g.days = t;
      else if ('target' in g) g.target = t;
      next.goal = g as QuestGoal;
    }
    const lines = diffLines({ title: q.title, target: goalText(q.goal!), endDate: q.endDate, xp: q.xp, coins: q.coins }, { title: next.title, target: goalText(next.goal!), endDate: next.endDate, xp: next.xp, coins: next.coins }, { title: 'Title', target: 'Target', endDate: 'Ends', xp: 'XP', coins: 'Coins' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    return {
      title: `Edit goal: ${q.title}`,
      lines,
      warnings: [],
      undo: 'snapshot',
      async apply() {
        const r = await addQuests([next]);
        return { message: `Updated goal "${next.title}".`, events: r.events };
      },
    };
  },

  async deleteGoal(a) {
    const q = await findGoal(String(a.goalId));
    if (q.status === 'completed') throw new ToolError('Completed goals can’t be deleted.');
    return {
      title: `Delete goal: ${q.title}`,
      lines: [{ label: 'Goal', before: `${q.title} · ${goalText(q.goal!)}`, after: 'deleted' }],
      warnings: [],
      undo: 'snapshot',
      async apply() {
        const r = await deleteQuest(q.id);
        return { message: `Deleted goal "${q.title}".`, events: r.events };
      },
    };
  },

  async createAchievement(a, ctx) {
    const counter = String(a.counter);
    if (!isKnownCounter(counter)) throw new ToolError(`Unknown counter "${counter}". Call getAchievementCounters and use one of its keys.`);
    const threshold = Number(a.threshold);
    const existing = await achievementRepository.all();
    if (existing.some((x) => x.condition.type === 'counter' && x.condition.key === counter && x.condition.gte === threshold && x.id.startsWith('custom_'))) throw new ToolError('An identical custom achievement already exists.');
    const tier = (a.tier as Achievement['tier']) ?? (threshold >= 100 ? 'gold' : threshold >= 25 ? 'silver' : 'bronze');
    const defaults = { bronze: [50, 10], silver: [120, 25], gold: [300, 60], platinum: [600, 120] }[tier];
    const ach: Achievement = {
      id: `custom_${slug(String(a.name))}_${uid().slice(-4)}`,
      name: String(a.name),
      description: String(a.description),
      category: 'long_term',
      icon: (a.icon as string) || '🏅',
      tier,
      hidden: !!a.hidden,
      condition: { type: 'counter', key: counter, gte: threshold },
      xp: a.xp !== undefined ? Number(a.xp) : defaults[0],
      coins: a.coins !== undefined ? Number(a.coins) : defaults[1],
    };
    const current = (await allCounters(ctx.player, ctx.settings))[counter] ?? 0;
    return {
      title: `New achievement: ${ach.name}`,
      lines: [
        { label: 'Unlocks when', after: `${counter} ≥ ${threshold}` },
        { label: 'Progress now', after: `${current} / ${threshold}` },
        { label: 'Reward', after: `+${ach.xp} XP · +${ach.coins} coins` },
      ],
      warnings: current >= threshold ? ['You already meet this condition: it will unlock right away.'] : [],
      undo: 'snapshot',
      async apply() {
        await achievementRepository.put(ach);
        return { message: `Created achievement "${ach.name}".`, data: { achievementId: ach.id }, events: [] };
      },
    };
  },

  async updateAchievement(a) {
    const ach = await findAchievement(String(a.achievementId));
    const next: Achievement = { ...ach, ...(a.name ? { name: String(a.name) } : {}), ...(a.description ? { description: String(a.description) } : {}), ...(a.xp !== undefined ? { xp: Number(a.xp) } : {}), ...(a.coins !== undefined ? { coins: Number(a.coins) } : {}), ...(a.icon ? { icon: String(a.icon) } : {}) };
    if (a.threshold !== undefined) {
      if (ach.condition.type !== 'counter') throw new ToolError('Only single-counter achievements can change threshold.');
      next.condition = { ...ach.condition, gte: Number(a.threshold) };
    }
    const cond = (x: Achievement) => (x.condition.type === 'counter' ? `${x.condition.key} ≥ ${x.condition.gte}` : 'combined');
    const lines = diffLines({ name: ach.name, description: ach.description, cond: cond(ach), xp: ach.xp, coins: ach.coins, icon: ach.icon }, { name: next.name, description: next.description, cond: cond(next), xp: next.xp, coins: next.coins, icon: next.icon }, { name: 'Name', description: 'Description', cond: 'Condition', xp: 'XP', coins: 'Coins', icon: 'Icon' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    return {
      title: `Edit achievement: ${ach.name}`,
      lines,
      warnings: ach.unlockedAt ? ['Already unlocked: changes don’t re-lock it or change rewards already granted.'] : [],
      undo: 'snapshot',
      async apply() {
        await achievementRepository.put(next);
        return { message: `Updated achievement "${next.name}".`, events: [] };
      },
    };
  },

  async deleteAchievement(a) {
    const ach = await findAchievement(String(a.achievementId));
    return {
      title: `Delete achievement: ${ach.name}`,
      lines: [{ label: 'Achievement', before: ach.name, after: 'deleted' }],
      warnings: [...(ach.id.startsWith('custom_') ? [] : ['This is a built-in achievement.']), ...(ach.unlockedAt ? ['It is unlocked: rewards already granted stay.'] : [])],
      undo: 'snapshot',
      async apply() {
        await achievementRepository.remove(ach.id);
        return { message: `Deleted achievement "${ach.name}".`, events: [] };
      },
    };
  },

  // ——— Targets ———

  async updateNutritionTargets(a, ctx) {
    const s = ctx.settings;
    const b = s.safety;
    const warnings: string[] = [];
    const next = { ...s.nutrition };
    if (a.calories !== undefined) {
      let c = Number(a.calories);
      if (c < b.calorieMin || c > b.calorieMax) throw new ToolError(`Calories must stay between ${b.calorieMin} and ${b.calorieMax} (safety bounds).`);
      const delta = c - s.nutrition.calories;
      if (Math.abs(delta) > b.calorieMaxAdjust) {
        c = s.nutrition.calories + Math.sign(delta) * b.calorieMaxAdjust;
        warnings.push(`Calorie targets change gradually: max ±${b.calorieMaxAdjust} kcal per step, so this step goes to ${c} kcal.`);
      }
      next.calories = c;
    }
    if (a.protein !== undefined) {
      const p = Number(a.protein);
      if (s.known.weight === 'set') {
        const lo = Math.round(b.proteinMinPerKg * s.body.weightKg);
        const hi = Math.round(b.proteinMaxPerKg * s.body.weightKg);
        if (p < lo || p > hi) throw new ToolError(`Protein must stay between ${lo} and ${hi} g for your body weight (safety bounds).`);
      }
      next.protein = p;
    }
    if (a.carbs !== undefined) next.carbs = Number(a.carbs);
    if (a.fat !== undefined) next.fat = Number(a.fat);
    const lines = diffLines(s.nutrition as unknown as A, next as unknown as A, { calories: 'Calories (kcal)', protein: 'Protein (g)', carbs: 'Carbs (g)', fat: 'Fat (g)' });
    return settingsPlan('Nutrition targets', ctx, { ...s, nutrition: next }, lines, warnings);
  },

  async updateWeightGoal(a, ctx) {
    const s = ctx.settings;
    const body = { ...s.body, ...(a.goal ? { goal: a.goal as Settings['body']['goal'] } : {}), ...(a.targetWeightKg !== undefined ? { targetWeightKg: Number(a.targetWeightKg) } : {}), ...(a.currentWeightKg !== undefined ? { weightKg: Number(a.currentWeightKg) } : {}) };
    const lines = diffLines({ goal: s.body.goal, targetWeightKg: s.body.targetWeightKg, weightKg: s.known.weight === 'set' ? s.body.weightKg : undefined }, { goal: body.goal, targetWeightKg: body.targetWeightKg, weightKg: a.currentWeightKg !== undefined ? body.weightKg : undefined }, { goal: 'Body goal', targetWeightKg: 'Target weight (kg)', weightKg: 'Current weight (kg)' });
    const warnings = body.targetWeightKg && Math.abs(body.targetWeightKg - body.weightKg) > 25 ? ['That is a big change: aim for about 0.25–0.75 kg per week.'] : [];
    const next = { ...s, body, known: a.currentWeightKg !== undefined ? { ...s.known, weight: 'set' as const } : s.known };
    return settingsPlan('Body goal', ctx, next, lines, warnings, async () => (a.currentWeightKg !== undefined ? (await logMetric('weight', Number(a.currentWeightKg), { mode: 'set', source: 'manual' })).events : []));
  },

  async updateStepGoal(a, ctx) {
    const s = ctx.settings;
    const b = s.safety;
    const ideal = Number(a.ideal);
    if (ideal < b.stepFloor || ideal > b.stepCeiling) throw new ToolError(`The step target must stay between ${b.stepFloor} and ${b.stepCeiling}.`);
    const min = a.min !== undefined ? Number(a.min) : Math.round((ideal * 0.85) / 250) * 250;
    const stretch = a.stretch !== undefined ? Number(a.stretch) : Math.round((ideal * 1.3) / 250) * 250;
    if (!(min <= ideal && ideal <= stretch)) throw new ToolError('Use min ≤ ideal ≤ stretch.');
    const warnings = s.steps.ideal && ideal > s.steps.ideal * (1 + b.maxStepIncreasePct / 100) ? [`That is more than +${b.maxStepIncreasePct}% at once: consider increasing gradually.`] : [];
    const next = { ...s, steps: { min, ideal, stretch }, known: { ...s.known, steps: 'set' as const } };
    return settingsPlan('Step targets', ctx, next, diffLines(s.steps as unknown as A, next.steps as unknown as A, { min: 'Minimum', ideal: 'Target', stretch: 'Stretch' }), warnings);
  },

  async updateWaterGoal(a, ctx) {
    const s = ctx.settings;
    const t = Number(a.targetMl);
    if (t < s.safety.waterMinMl || t > s.safety.waterMaxMl) throw new ToolError(`Water must stay between ${s.safety.waterMinMl} and ${s.safety.waterMaxMl} ml.`);
    const next = { ...s, hydration: { targetMl: t, glassMl: a.glassMl !== undefined ? Number(a.glassMl) : s.hydration.glassMl } };
    return settingsPlan('Water target', ctx, next, diffLines(s.hydration as unknown as A, next.hydration as unknown as A, { targetMl: 'Daily water (ml)', glassMl: 'Glass (ml)' }));
  },

  // ——— Workouts ———

  async updateWorkout(a) {
    const plan = await activePlanOrThrow();
    const t = templateOrThrow(plan, String(a.templateId));
    const next = { ...t, ...(a.name ? { name: String(a.name) } : {}), ...(a.weekday !== undefined ? { weekday: a.weekday as number | null } : {}), ...(a.estimatedMin ? { estimatedMin: Number(a.estimatedMin) } : {}) };
    const day = (w: number | null) => (w === null || w === undefined ? 'Flexible' : WD[w]);
    const lines = diffLines({ name: t.name, weekday: day(t.weekday), estimatedMin: t.estimatedMin }, { name: next.name, weekday: day(next.weekday), estimatedMin: next.estimatedMin }, { name: 'Name', weekday: 'Day', estimatedMin: 'Minutes' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    return {
      title: `Edit workout: ${t.name}`,
      lines,
      warnings: [],
      undo: 'snapshot',
      async apply() {
        await savePlan({ ...plan, templates: plan.templates.map((x) => (x.id === t.id ? next : x)) });
        return { message: `Updated workout "${next.name}".`, events: [] };
      },
    };
  },

  async addWorkoutExercise(a) {
    const plan = await activePlanOrThrow();
    const t = templateOrThrow(plan, String(a.templateId));
    const ex = await workoutRepository.exercises.get(String(a.exerciseId));
    if (!ex) throw new ToolError(`Exercise "${a.exerciseId}" not found. Call getExercises.`);
    if (t.exercises.some((e) => e.exerciseId === ex.id)) throw new ToolError(`${ex.name} is already in ${t.name}.`);
    const entry = { exerciseId: ex.id, sets: Number(a.sets ?? ex.defaultSets), repMin: Number(a.repMin ?? ex.repMin), repMax: Number(a.repMax ?? ex.repMax), restSec: Number(a.restSec ?? ex.restSec) };
    if (entry.repMin > entry.repMax) throw new ToolError('repMin must be ≤ repMax.');
    const pos = Math.min(Number(a.position ?? t.exercises.length), t.exercises.length);
    const exercises = [...t.exercises.slice(0, pos), entry, ...t.exercises.slice(pos)];
    const warnings = exercises.reduce((s, e) => s + e.sets, 0) > 28 ? ['That is a lot of sets for one session.'] : [];
    return {
      title: `Add ${ex.name} to ${t.name}`,
      lines: [{ label: ex.name, after: `${entry.sets} × ${entry.repMin}-${entry.repMax}, rest ${entry.restSec}s` }, { label: 'Exercises', before: String(t.exercises.length), after: String(exercises.length) }],
      warnings,
      undo: 'snapshot',
      async apply() {
        await savePlan({ ...plan, templates: plan.templates.map((x) => (x.id === t.id ? { ...x, exercises } : x)) });
        return { message: `Added ${ex.name} to ${t.name}.`, events: [] };
      },
    };
  },

  async removeWorkoutExercise(a) {
    const plan = await activePlanOrThrow();
    const t = templateOrThrow(plan, String(a.templateId));
    if (!t.exercises.some((e) => e.exerciseId === a.exerciseId)) throw new ToolError(`That exercise is not in ${t.name}.`);
    const ex = await workoutRepository.exercises.get(String(a.exerciseId));
    return {
      title: `Remove ${ex?.name ?? a.exerciseId} from ${t.name}`,
      lines: [{ label: 'Exercises', before: String(t.exercises.length), after: String(t.exercises.length - 1) }],
      warnings: t.exercises.length <= 2 ? ['The workout will be very short.'] : [],
      undo: 'snapshot',
      async apply() {
        await savePlan({ ...plan, templates: plan.templates.map((x) => (x.id === t.id ? { ...x, exercises: x.exercises.filter((e) => e.exerciseId !== a.exerciseId) } : x)) });
        return { message: `Removed ${ex?.name ?? a.exerciseId} from ${t.name}.`, events: [] };
      },
    };
  },

  async updateExerciseParameters(a, ctx) {
    const plan = await activePlanOrThrow();
    const t = templateOrThrow(plan, String(a.templateId));
    const cur = t.exercises.find((e) => e.exerciseId === a.exerciseId);
    if (!cur) throw new ToolError(`That exercise is not in ${t.name}.`);
    const ex = await workoutRepository.exercises.get(cur.exerciseId);
    const state = await workoutRepository.states.get(cur.exerciseId);
    const next = { ...cur, ...(a.sets ? { sets: Number(a.sets) } : {}), ...(a.repMin ? { repMin: Number(a.repMin) } : {}), ...(a.repMax ? { repMax: Number(a.repMax) } : {}), ...(a.restSec !== undefined ? { restSec: Number(a.restSec) } : {}) };
    if (next.repMin > next.repMax) throw new ToolError('repMin must be ≤ repMax.');
    const warnings: string[] = [];
    let weight: number | undefined;
    if (a.workingWeight !== undefined) {
      weight = Number(a.workingWeight);
      const before = state?.workingWeight ?? 0;
      const cap = ctx.settings.safety.maxTrainingIncreasePct;
      if (before > 0 && weight > before * (1 + cap / 100)) {
        weight = Math.round(before * (1 + cap / 100) * 2) / 2;
        warnings.push(`Weight increases are capped at +${cap}% per step, so this step goes to ${weight} kg.`);
      }
    }
    const lines = diffLines({ sets: cur.sets, reps: `${cur.repMin}-${cur.repMax}`, restSec: cur.restSec, weight: state?.workingWeight }, { sets: next.sets, reps: `${next.repMin}-${next.repMax}`, restSec: next.restSec, weight }, { sets: 'Sets', reps: 'Reps', restSec: 'Rest (s)', weight: 'Working weight (kg)' });
    if (!lines.length) throw new ToolError('Nothing would change.');
    return {
      title: `${ex?.name ?? cur.exerciseId} in ${t.name}`,
      lines,
      warnings,
      undo: 'snapshot',
      async apply() {
        await savePlan({ ...plan, templates: plan.templates.map((x) => (x.id === t.id ? { ...x, exercises: x.exercises.map((e) => (e.exerciseId === cur.exerciseId ? next : e)) } : x)) });
        if (weight !== undefined) await setWorkingWeight(cur.exerciseId, weight, next.repMin, next.repMax);
        return { message: `Updated ${ex?.name ?? cur.exerciseId}.`, events: [] };
      },
    };
  },

  // ——— Schedule (reuses the Coach's config engine) ———

  async setWorkSchedule(a, ctx) {
    const days: WorkDayEntry[] = Array.from({ length: 7 }, () => ({ kind: 'off' as const }));
    const given = a.days as { weekday: number; kind: string; start?: string; end?: string; breakMin?: number; approximate?: boolean }[];
    for (const d of given) {
      days[d.weekday] = d.kind === 'work' ? { kind: 'work', start: d.start, end: d.end, breakMin: d.breakMin, approximate: d.approximate } : d.kind === 'unknown' ? { kind: 'unknown' } : { kind: 'off' };
      if (d.start && d.end && d.end <= d.start && d.end !== '00:00') throw new ToolError(`End time must be after start on weekday ${d.weekday} (or pass times separately if it ends after midnight).`);
    }
    const from = (a.effectiveFrom as string) ?? ctx.today;
    requireFuture(from, ctx.today);
    const warnings = given.length < 7 ? ['Days not mentioned are treated as days off.'] : [];
    return configPlan('Regular work week', [{ type: 'work_schedule', days, effectiveFrom: from, variable: !!a.variable }], ctx, warnings);
  },

  async setOneOffWorkDay(a, ctx) {
    const date = String(a.date);
    requireFuture(date, ctx.today);
    const entry: WorkDayEntry = a.kind === 'work' ? { kind: 'work', start: a.start as string | undefined, end: a.end as string | undefined } : a.kind === 'unknown' ? { kind: 'unknown' } : { kind: 'off' };
    return configPlan(`Work on ${fmtDate(date)} only`, [{ type: 'temporary_work', dates: [date], entry }], ctx, ['Your regular week does not change.']);
  },

  async setWorkScheduleUnknown(_a, ctx) {
    return configPlan('Work schedule: not sure yet', [{ type: 'work_status', status: 'unknown' }], ctx);
  },

  async addAvailabilityException(a, ctx) {
    const from = String(a.from);
    requireFuture(from, ctx.today);
    if (a.to && String(a.to) < from) throw new ToolError('"to" must be on or after "from".');
    return configPlan('Availability change', [{ type: 'exception', kind: a.kind as never, from, to: a.to as string | undefined, note: a.note as string | undefined }], ctx);
  },

  async setLoadMode(a, ctx) {
    if (ctx.settings.load.mode === a.mode) throw new ToolError(`Load mode is already "${a.mode}".`);
    return configPlan('Load mode', [{ type: 'load_mode', mode: a.mode as never }], ctx);
  },

  async updateDailyRhythm(a, ctx) {
    if (!a.wake && !a.sleep) throw new ToolError('Give wake and/or sleep.');
    const changes: ConfigChange[] = [...(a.wake ? [{ type: 'wake' as const, time: String(a.wake) }] : []), ...(a.sleep ? [{ type: 'sleep' as const, time: String(a.sleep) }] : [])];
    const plan = configPlan('Daily rhythm', changes, ctx);
    plan.lines = diffLines({ wake: ctx.settings.known.wake === 'set' ? ctx.settings.schedule.wake : undefined, sleep: ctx.settings.known.sleep === 'set' ? ctx.settings.schedule.sleep : undefined }, { wake: a.wake, sleep: a.sleep }, { wake: 'Wake up', sleep: 'Bedtime' });
    return plan;
  },

  // ——— Game rules ———

  async updateGameRules(a, ctx) {
    const rules = structuredClone(ctx.settings.rules) as unknown as Record<string, unknown>;
    const lines: PreviewLine[] = [];
    const warnings: string[] = [];
    for (const { path, value } of a.changes as { path: string; value: number }[]) {
      const keys = path.split('.');
      if (keys[0] === 'smartRules' || keys[0] === 'difficultyPresets') throw new ToolError(`"${path}" can’t be changed from the Coach.`);
      let node = rules;
      for (const k of keys.slice(0, -1)) {
        if (!node || typeof node[k] !== 'object') throw new ToolError(`Unknown rule "${path}". Call getGameRules for valid paths.`);
        node = node[k] as Record<string, unknown>;
      }
      const last = keys.at(-1)!;
      const before = node[last];
      if (typeof before !== 'number') throw new ToolError(`Unknown rule "${path}". Call getGameRules for valid paths.`);
      if (value < 0) throw new ToolError(`"${path}" can’t be negative.`);
      if (before > 0 && (value > before * 10 || value < before / 10)) warnings.push(`${path}: a ×10 change can unbalance the game.`);
      node[last] = value;
      lines.push({ label: path, before: String(before), after: String(value) });
    }
    const next = { ...ctx.settings, rules: rules as unknown as Settings['rules'] };
    return settingsPlan('Game rules', ctx, next, lines, warnings);
  },

  async updateBuildingCosts(a) {
    const all = await tycoonRepository.buildings.all();
    const targets = a.buildingId === 'all' ? all : all.filter((b) => b.id === a.buildingId);
    if (!targets.length) throw new ToolError(`Room "${a.buildingId}" not found. Call getTycoonWorld.`);
    if (a.multiplier === undefined && a.baseCost === undefined && a.costGrowth === undefined) throw new ToolError('Give a multiplier, baseCost or costGrowth.');
    const next = targets.map((b) => ({
      ...b,
      baseCost: a.baseCost !== undefined ? Number(a.baseCost) : a.multiplier !== undefined ? Math.max(10, Math.round(b.baseCost * Number(a.multiplier))) : b.baseCost,
      costGrowth: a.costGrowth !== undefined ? Number(a.costGrowth) : b.costGrowth,
    }));
    const lines: PreviewLine[] = next.slice(0, 8).map((b, i) => ({ label: `${b.name} next level`, before: String(buildingCost(targets[i], Math.min(targets[i].level + 1, targets[i].maxLevel))), after: String(buildingCost(b, Math.min(b.level + 1, b.maxLevel))) }));
    if (next.length > 8) lines.push({ label: `…and ${next.length - 8} more rooms` });
    return {
      title: a.buildingId === 'all' ? 'Room prices (all rooms)' : `Room prices: ${targets[0].name}`,
      lines,
      warnings: [],
      undo: 'snapshot',
      async apply() {
        await tycoonRepository.buildings.bulkPut(next);
        return { message: 'Room prices updated.', events: [] };
      },
    };
  },

  // ——— Resets ———

  ...Object.fromEntries(Object.entries(RESET_TOOL).map(([name, kind]) => [name, async () => resetPlan(kind)])),
};
