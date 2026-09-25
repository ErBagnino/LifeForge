import { DEFAULT_CARDIO_STAGES } from '@/data/cardio';
import { CATEGORY_INFO } from '@/data/categories';
import type { PickedTemplate } from '@/domain/questGenerator';
import { computeQuestValues } from '@/domain/rewards';
import type {
  Activity,
  CardioStage,
  Difficulty,
  ISODate,
  MetricType,
  Quest,
  QuestKind,
  QuestTier,
  Rarity,
  Settings,
  TimeHM,
  WorkoutTemplate,
} from '@/types';
import { uid } from '@/utils/id';
import { roundTo } from '@/utils/math';

export interface FactoryContext {
  settings: Settings;
  level: number;
  date: ISODate;
  now: number;
}

export function resolveText(text: string, petName: string): string {
  return text.replace(/\{pet\}/g, petName).replace(/\{PET\}/g, petName.toUpperCase());
}

/** Quest target for metric-driven activities, read live from settings. */
export function metricTarget(metric: MetricType, settings: Settings, fallback?: number): number | undefined {
  switch (metric) {
    case 'water':
      return settings.hydration.targetMl;
    case 'steps':
      return settings.steps.ideal;
    case 'protein':
      return settings.nutrition.protein;
    case 'calories':
      return settings.nutrition.calories;
    case 'sleep':
      return 1;
    case 'weight':
      return 1;
    case 'leisure':
      return settings.leisure.dailyLimitMin;
    default:
      return fallback;
  }
}

export function cardioStage(settings: Settings): CardioStage {
  return DEFAULT_CARDIO_STAGES[Math.min(settings.cardio.stageIndex, DEFAULT_CARDIO_STAGES.length - 1)];
}

function baseQuest(ctx: FactoryContext, fields: Partial<Quest> & Pick<Quest, 'kind' | 'tier' | 'title' | 'icon' | 'category' | 'difficulty' | 'durationMin'>): Quest {
  return {
    id: uid('q_'),
    date: ctx.date,
    rarity: 'common',
    xp: 0,
    coins: 0,
    energyCost: 0,
    stats: { ...CATEGORY_INFO[fields.category].stats },
    progress: 0,
    status: 'pending',
    snoozeCount: 0,
    rescheduleCount: 0,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    ...fields,
  };
}

export interface ActivityQuestOptions {
  kind?: QuestKind;
  tier?: QuestTier;
  rarity?: Rarity;
  durationMin?: number;
  quantity?: number;
  reason?: string;
  scheduledTime?: TimeHM;
}

export function questFromActivity(a: Activity, ctx: FactoryContext, opts: ActivityQuestOptions = {}): Quest {
  const pet = ctx.settings.profile.petName;
  const rarity = opts.rarity ?? 'common';
  let durationMin = opts.durationMin ?? a.durationMin;
  let title = resolveText(a.name, pet);
  let description = a.description ? resolveText(a.description, pet) : undefined;

  const isCardio = a.tags?.includes('cardio_program');
  if (isCardio) {
    const stage = cardioStage(ctx.settings);
    durationMin = stage.durationMin;
    title = `Cardio · ${stage.name}`;
    description = `${stage.description}${stage.structure ? ` ${stage.structure}.` : ''}`;
  }

  const values = computeQuestValues(
    {
      difficulty: a.difficulty,
      durationMin,
      importance: a.importance,
      recurrence: a.recurrence,
      rarity,
      category: a.category,
      baseXp: a.baseXp,
      baseCoins: a.baseCoins,
      energyCost: a.energyCost,
    },
    ctx.level,
    ctx.settings.rules,
  );
  const quantity = opts.quantity ?? a.quantity;
  const target = a.metric ? metricTarget(a.metric, ctx.settings, quantity) : quantity;
  if (opts.quantity !== undefined && a.scalable?.field === 'quantity' && a.unit) title = `${title} (${quantity} ${a.unit})`;
  else if (opts.durationMin !== undefined && a.scalable?.field === 'duration' && a.unit === 'min') title = `${durationMin} min ${title}`;

  return baseQuest(ctx, {
    kind: opts.kind ?? (a.recurrence.type === 'pool' ? 'side' : 'scheduled'),
    tier: opts.tier ?? a.tier,
    activityId: a.id,
    title,
    icon: a.icon,
    category: a.category,
    description,
    difficulty: a.difficulty,
    rarity,
    ...values,
    stats: { ...a.stats },
    target: a.metric ? target : undefined,
    unit: a.unit,
    metric: a.metric,
    metricMode: a.metricMode,
    durationMin,
    scheduledTime: opts.scheduledTime ?? a.preferredTime,
    reason: opts.reason,
    private: a.tags?.includes('private') || undefined,
  });
}

export function workoutQuest(t: WorkoutTemplate, ctx: FactoryContext, scheduledTime?: TimeHM): Quest {
  const difficulty: Difficulty = t.estimatedMin >= 60 ? 4 : 3;
  const values = computeQuestValues(
    { difficulty, durationMin: t.estimatedMin, importance: 5, recurrence: { type: 'timesPerWeek', times: 3 }, rarity: 'common', category: 'fitness' },
    ctx.level,
    ctx.settings.rules,
  );
  return baseQuest(ctx, {
    kind: 'workout',
    tier: 'core',
    workoutTemplateId: t.id,
    title: `Workout · ${t.name}`,
    icon: '🏋️',
    category: 'fitness',
    description: `${t.exercises.length} exercises · ~${t.estimatedMin} min. Tap to open the logger.`,
    difficulty,
    ...values,
    stats: { strength: 3, discipline: 1, endurance: 1 },
    durationMin: t.estimatedMin,
    scheduledTime,
  });
}

const KIND_MULTIPLIER: Partial<Record<QuestKind, number>> = { challenge: 1.3, hidden: 1.2, weekly: 2, boss: 4 };

export function goalQuest(
  picked: PickedTemplate,
  kind: 'challenge' | 'hidden' | 'weekly' | 'boss',
  ctx: FactoryContext,
  window: { date: ISODate; endDate?: ISODate },
): Quest {
  const t = picked.template;
  const refDuration = ctx.settings.rules.xp.refDurationByDifficulty[t.difficulty];
  const values = computeQuestValues(
    { difficulty: t.difficulty, durationMin: refDuration, importance: 3, rarity: picked.rarity, category: t.category },
    ctx.level,
    ctx.settings.rules,
  );
  const mult = KIND_MULTIPLIER[kind] ?? 1;
  return baseQuest(ctx, {
    date: window.date,
    endDate: window.endDate,
    kind,
    tier: 'optional',
    title: t.title,
    icon: t.icon,
    category: t.category,
    description: picked.description,
    difficulty: t.difficulty,
    rarity: picked.rarity,
    xp: roundTo(values.xp * mult, 5),
    coins: Math.round(values.coins * mult),
    energyCost: 0,
    durationMin: 0,
    goal: picked.goal,
    hidden: kind === 'hidden' || undefined,
    hint: picked.hint,
  });
}

/** The onboarding quest: tiny, instant, and it pays for the first micro-upgrade. */
export function firstQuest(ctx: FactoryContext): Quest {
  return baseQuest(ctx, {
    kind: 'first',
    tier: 'optional',
    title: 'Drink a glass of water',
    icon: '🥛',
    category: 'hydration',
    description: 'Your first quest. Go drink a glass of water, then tap complete. Welcome to the game.',
    difficulty: 1,
    rarity: 'rare',
    xp: 60,
    coins: ctx.settings.rules.coins.firstQuestBonus + 25,
    energyCost: 0,
    stats: { health: 1, discipline: 1 },
    durationMin: 1,
    reason: 'Tutorial',
  });
}

export function manualQuest(
  ctx: FactoryContext,
  input: { title: string; icon: string; category: Quest['category']; difficulty: Difficulty; durationMin: number; tier: QuestTier },
): Quest {
  const values = computeQuestValues(
    { difficulty: input.difficulty, durationMin: input.durationMin, importance: 3, rarity: 'common', category: input.category },
    ctx.level,
    ctx.settings.rules,
  );
  return baseQuest(ctx, { kind: 'manual', ...input, ...values });
}
