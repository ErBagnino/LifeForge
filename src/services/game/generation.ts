import { BOSS_TEMPLATES, CHALLENGE_TEMPLATES, HIDDEN_TEMPLATES, WEEKLY_TEMPLATES } from '@/data/questTemplates';
import type { SideQuestBudget } from '@/domain/adaptive';
import { FEATURE_LEVELS } from '@/domain/level';
import { generateSideQuests, type GeneratorHistory, pickTemplates, type TemplateContext } from '@/domain/questGenerator';
import { activityRepository, questRepository, workoutRepository } from '@/repositories';
import type { ActivityCategory, DifficultyState, ISODate, Quest, Settings, TimeOfDay } from '@/types';
import { daysBetween, monthEnd, monthStart, parseDate, shiftDate, timeOfDayFromMinutes, weekEnd, weekStart } from '@/utils/date';
import { clock } from '../clock';
import { type FactoryContext, goalQuest, questFromActivity } from './questFactory';

export function buildHistory(quests: Quest[], today: ISODate): GeneratorHistory {
  const history: GeneratorHistory = { lastGenerated: {}, completed14d: {}, skipped14d: {}, categoryCompleted7d: {} };
  for (const q of quests) {
    if (!q.activityId) continue;
    const age = daysBetween(q.date, today);
    if (q.kind === 'side' && (!history.lastGenerated[q.activityId] || history.lastGenerated[q.activityId] < q.date)) {
      history.lastGenerated[q.activityId] = q.date;
    }
    if (age <= 14 && q.status === 'completed') history.completed14d[q.activityId] = (history.completed14d[q.activityId] ?? 0) + 1;
    if (age <= 14 && q.status === 'skipped') history.skipped14d[q.activityId] = (history.skipped14d[q.activityId] ?? 0) + 1;
    if (age <= 7 && q.status === 'completed') {
      history.categoryCompleted7d[q.category] = (history.categoryCompleted7d[q.category] ?? 0) + 1;
    }
  }
  return history;
}

export function focusCategories(longQuests: Quest[]): ActivityCategory[] {
  const out = new Set<ActivityCategory>();
  for (const q of longQuests) {
    if (q.status !== 'pending' || !q.goal) continue;
    if (q.goal.type === 'completeCount' && q.goal.category) out.add(q.goal.category);
    if (q.goal.type === 'workouts') out.add('fitness');
    if (q.goal.type === 'metricSum' && q.goal.metric === 'steps') out.add('cardio');
  }
  return [...out];
}

export interface SideGenInput {
  ctx: FactoryContext;
  dayQuests: Quest[];
  longQuests: Quest[];
  budget: SideQuestBudget;
  state: DifficultyState;
  ownedBuildings: Set<string>;
  freeMinutes: number;
  seed: string;
  timeOfDay?: TimeOfDay;
  reason?: string;
}

export async function generateSideQuestsFor(input: SideGenInput): Promise<Quest[]> {
  const { ctx } = input;
  const [activities, recent] = await Promise.all([
    activityRepository.active(),
    questRepository.byRange(shiftDate(ctx.date, -14), ctx.date),
  ]);
  const specs = generateSideQuests({
    date: ctx.date,
    seed: input.seed,
    candidates: activities,
    excludeIds: new Set(input.dayQuests.map((q) => q.activityId).filter((x): x is string => !!x)),
    budget: input.budget,
    history: buildHistory(recent, ctx.date),
    focusCategories: focusCategories(input.longQuests),
    level: ctx.level,
    state: input.state,
    timeOfDay: input.timeOfDay ?? 'anytime',
    ownedBuildings: input.ownedBuildings,
    rarityWeights: ctx.settings.rules.generator.rarityWeights,
    recencyDays: ctx.settings.rules.generator.recencyDays,
    freeMinutes: input.freeMinutes,
  });
  return specs.map((s) =>
    questFromActivity(s.activity, ctx, {
      kind: 'side',
      tier: 'optional',
      rarity: s.rarity,
      durationMin: s.activity.scalable ? s.durationMin : undefined,
      quantity: s.activity.scalable?.field === 'quantity' ? s.quantity : undefined,
      reason: input.reason ?? s.reason,
    }),
  );
}

export async function templateContext(
  settings: Settings,
  date: ISODate,
  level: number,
  dayType: 'work' | 'free' | 'rest',
  state: DifficultyState,
): Promise<TemplateContext> {
  const plan = await workoutRepository.activePlan();
  const d = parseDate(date);
  return {
    date,
    level,
    dayType,
    state,
    stepsIdeal: settings.steps.ideal,
    stepsStretch: settings.steps.stretch,
    waterTargetMl: settings.hydration.targetMl,
    proteinTarget: settings.nutrition.protein,
    trackNutrition: settings.tracking.nutrition,
    plannedWorkoutsPerWeek: plan?.templates.filter((t) => t.weekday !== null).length ?? 0,
    petName: settings.profile.petName,
    streakThreshold: settings.rules.difficultyPresets[settings.difficulty].streakThreshold,
    daysInMonth: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
  };
}

export async function generateChallenge(ctx: FactoryContext, tctx: TemplateContext, boost: number): Promise<Quest[]> {
  if (ctx.level < FEATURE_LEVELS.challenge || !ctx.settings.rules.generator.challengeEnabled) return [];
  const picked = pickTemplates(CHALLENGE_TEMPLATES, tctx, 1, 'challenge', ctx.settings.rules.generator.rarityWeights, {
    minRarity: 'uncommon',
    boost,
  });
  return picked.map((p) => goalQuest(p, 'challenge', ctx, { date: ctx.date }));
}

export async function generateHidden(ctx: FactoryContext, tctx: TemplateContext): Promise<Quest[]> {
  if (ctx.level < FEATURE_LEVELS.hidden || !ctx.settings.rules.generator.hiddenEnabled) return [];
  const picked = pickTemplates(HIDDEN_TEMPLATES, tctx, 1, 'hidden', ctx.settings.rules.generator.rarityWeights, { minRarity: 'rare' });
  return picked.map((p) => goalQuest(p, 'hidden', ctx, { date: ctx.date }));
}

/** Weekly quests are created once per ISO week; boss quests once per month. */
export async function generateLongQuests(ctx: FactoryContext, tctx: TemplateContext, existingLong: Quest[]): Promise<Quest[]> {
  const out: Quest[] = [];
  const g = ctx.settings.rules.generator;
  const ws = weekStart(ctx.date);
  if (ctx.level >= FEATURE_LEVELS.weekly && g.weeklyCount > 0 && !existingLong.some((q) => q.kind === 'weekly' && q.date === ws)) {
    const picked = pickTemplates(WEEKLY_TEMPLATES, tctx, g.weeklyCount, `weekly:${ws}`, g.rarityWeights, { minRarity: 'uncommon' });
    out.push(...picked.map((p) => goalQuest(p, 'weekly', ctx, { date: ws, endDate: weekEnd(ctx.date) })));
  }
  const ms = monthStart(ctx.date);
  if (ctx.level >= FEATURE_LEVELS.boss && g.bossEnabled && !existingLong.some((q) => q.kind === 'boss' && q.date === ms)) {
    const picked = pickTemplates(BOSS_TEMPLATES, tctx, 1, `boss:${ms}`, g.rarityWeights, { minRarity: 'epic' });
    out.push(...picked.map((p) => goalQuest(p, 'boss', ctx, { date: ms, endDate: monthEnd(ctx.date) })));
  }
  return out;
}

export function currentTimeOfDay(): TimeOfDay {
  return timeOfDayFromMinutes(clock.minute());
}
