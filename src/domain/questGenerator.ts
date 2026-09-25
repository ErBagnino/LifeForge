import type {
  Activity,
  ActivityCategory,
  DifficultyState,
  ID,
  ISODate,
  QuestGoal,
  Rarity,
  TimeOfDay,
} from '@/types';
import { RARITIES } from '@/types';
import { daysBetween } from '@/utils/date';
import { clamp, createRng, floorTo, hashString, weightedIndex } from '@/utils/math';
import type { SideQuestBudget } from './adaptive';

export interface GeneratorHistory {
  /** activityId → last date it was proposed as a side quest */
  lastGenerated: Record<ID, ISODate>;
  completed14d: Record<ID, number>;
  skipped14d: Record<ID, number>;
  categoryCompleted7d: Partial<Record<ActivityCategory, number>>;
}

export interface GeneratorInput {
  date: ISODate;
  seed: string;
  candidates: Activity[];
  excludeIds: Set<ID>;
  budget: SideQuestBudget;
  history: GeneratorHistory;
  focusCategories: ActivityCategory[];
  level: number;
  state: DifficultyState;
  timeOfDay: TimeOfDay;
  ownedBuildings: Set<ID>;
  rarityWeights: Record<Rarity, number>;
  recencyDays: number;
  freeMinutes: number;
}

export interface GeneratedQuestSpec {
  activity: Activity;
  durationMin: number;
  quantity?: number;
  rarity: Rarity;
  reason: string;
}

export function rollRarity(rand: () => number, weights: Record<Rarity, number>, boost = 0): Rarity {
  const w = RARITIES.map((r) => (r === 'common' ? weights[r] : weights[r] * (1 + boost * 0.6)));
  const idx = weightedIndex(w, rand);
  return RARITIES[Math.max(0, idx)];
}

export function rarityAtLeast(rarity: Rarity, min: Rarity): Rarity {
  return RARITIES.indexOf(rarity) >= RARITIES.indexOf(min) ? rarity : min;
}

/** Size a scalable activity to the time available ("5 MIN ROOM RESET" on a busy day, 15 on a free one). */
export function scaleActivity(activity: Activity, maxDuration: number): { durationMin: number; quantity?: number } {
  const spec = activity.scalable;
  if (!spec) return { durationMin: activity.durationMin, quantity: activity.quantity };
  if (spec.field === 'duration') {
    const value = clamp(floorTo(Math.min(spec.max, maxDuration), spec.step), spec.min, spec.max);
    return { durationMin: value, quantity: activity.unit === 'min' ? value : activity.quantity };
  }
  const intensity = clamp((maxDuration - 10) / 35, 0, 1);
  const quantity = clamp(floorTo(spec.min + (spec.max - spec.min) * intensity, spec.step), spec.min, spec.max);
  const base = activity.quantity || spec.min;
  const durationMin = Math.max(3, Math.round((activity.durationMin * quantity) / Math.max(1, base)));
  return { durationMin, quantity };
}

function minDuration(activity: Activity): number {
  return activity.scalable?.field === 'duration' ? activity.scalable.min : activity.durationMin;
}

function difficultyFit(difficulty: number, state: DifficultyState): number {
  switch (state) {
    case 'too_easy':
      return difficulty >= 3 ? 1.5 : difficulty === 2 ? 1 : 0.6;
    case 'overloaded':
      return difficulty <= 2 ? 1.4 : 0.25;
    case 'critical':
      return difficulty <= 1 ? 1 : 0.1;
    case 'balanced':
      return difficulty === 2 || difficulty === 3 ? 1.2 : difficulty === 1 ? 0.9 : 0.6;
  }
}

function timeFit(activity: Activity, tod: TimeOfDay): number {
  if (activity.timeOfDay === 'anytime' || tod === 'anytime') return 1;
  return activity.timeOfDay === tod ? 1.3 : 0.8;
}

interface Scored {
  activity: Activity;
  weight: number;
  reason: string;
}

/**
 * Pick side quests. Deterministic for a given seed, avoids repetition, respects
 * time/energy budgets and prefers neglected or focus categories.
 */
export function generateSideQuests(input: GeneratorInput): GeneratedQuestSpec[] {
  const { budget, history } = input;
  if (budget.count <= 0) return [];
  const rand = createRng(hashString(`${input.seed}:${input.date}`));

  const scored: Scored[] = [];
  for (const a of input.candidates) {
    if (!a.active || !a.generatorEligible || input.excludeIds.has(a.id)) continue;
    if (a.requiresBuilding && !input.ownedBuildings.has(a.requiresBuilding)) continue;
    if (a.difficulty >= 4 && input.level < 3) continue;
    if (a.difficulty >= 5 && input.level < 8) continue;
    if (minDuration(a) > budget.maxDuration) continue;

    let weight = 1;
    let reason = `Fits your ${budget.maxDuration}-minute window`;
    let reasonScore = 0;

    const catCount = history.categoryCompleted7d[a.category] ?? 0;
    if (catCount === 0) {
      weight += 0.8;
      if (reasonScore < 2) {
        reason = `You haven't touched ${a.category.replace(/_/g, ' ')} in a week`;
        reasonScore = 2;
      }
    } else if (catCount <= 1) weight += 0.4;

    if (input.focusCategories.includes(a.category)) {
      weight += 0.6;
      if (reasonScore < 3) {
        reason = 'Pushes one of your weekly quests';
        reasonScore = 3;
      }
    }

    const last = history.lastGenerated[a.id];
    if (last && daysBetween(last, input.date) <= input.recencyDays) weight *= 0.12;

    const skipped = history.skipped14d[a.id] ?? 0;
    weight *= 1 / (1 + skipped * 0.6);

    const completed = history.completed14d[a.id] ?? 0;
    weight *= 1 + Math.min(completed, 5) * 0.06;

    weight *= difficultyFit(a.difficulty, input.state);
    if (input.state === 'too_easy' && a.difficulty >= 3 && reasonScore < 1) {
      reason = "You're cruising — here's something with teeth";
      reasonScore = 1;
    }
    weight *= timeFit(a, input.timeOfDay);
    weight *= 0.75 + rand() * 0.5;

    if (weight > 0.01) scored.push({ activity: a, weight, reason });
  }

  const picked: GeneratedQuestSpec[] = [];
  const usedCategories = new Set<ActivityCategory>();
  let energyLeft = budget.energyBudget;
  let minutesLeft = input.freeMinutes;
  const pool = [...scored];

  while (picked.length < budget.count && pool.length > 0) {
    const idx = weightedIndex(
      pool.map((s) => s.weight),
      rand,
    );
    if (idx < 0) break;
    const [choice] = pool.splice(idx, 1);
    const a = choice.activity;
    if (usedCategories.has(a.category)) continue;
    const size = scaleActivity(a, budget.maxDuration);
    const cost = a.energyCost ?? 0;
    if (cost > 0 && cost > energyLeft) continue;
    if (size.durationMin > minutesLeft) continue;
    energyLeft -= Math.max(0, cost);
    minutesLeft -= size.durationMin;
    usedCategories.add(a.category);
    picked.push({
      activity: a,
      durationMin: size.durationMin,
      quantity: size.quantity,
      rarity: rollRarity(rand, input.rarityWeights, budget.challengeBoost > 0 ? 1 : 0),
      reason: choice.reason,
    });
  }
  return picked;
}

// ——— Templates for challenges, hidden, weekly and boss quests ———

export interface TemplateContext {
  date: ISODate;
  level: number;
  dayType: 'work' | 'free' | 'rest';
  state: DifficultyState;
  stepsIdeal: number;
  stepsStretch: number;
  waterTargetMl: number;
  proteinTarget: number;
  trackNutrition: boolean;
  plannedWorkoutsPerWeek: number;
  petName: string;
  streakThreshold: number;
  daysInMonth: number;
}

export interface QuestTemplate {
  id: string;
  title: string;
  icon: string;
  category: ActivityCategory;
  difficulty: 1 | 2 | 3 | 4 | 5;
  minLevel: number;
  /** Relative pick weight (0 = not eligible). */
  weight: (ctx: TemplateContext) => number;
  build: (ctx: TemplateContext) => { goal: QuestGoal; description: string; hint?: string };
}

export interface PickedTemplate {
  template: QuestTemplate;
  goal: QuestGoal;
  description: string;
  hint?: string;
  rarity: Rarity;
}

export function pickTemplates(
  templates: QuestTemplate[],
  ctx: TemplateContext,
  count: number,
  seed: string,
  rarityWeights: Record<Rarity, number>,
  opts: { minRarity?: Rarity; boost?: number; exclude?: Set<string> } = {},
): PickedTemplate[] {
  const rand = createRng(hashString(`${seed}:${ctx.date}`));
  const pool = templates
    .filter((t) => t.minLevel <= ctx.level && !opts.exclude?.has(t.id))
    .map((t) => ({ t, w: t.weight(ctx) }))
    .filter((x) => x.w > 0);
  const out: PickedTemplate[] = [];
  while (out.length < count && pool.length) {
    const idx = weightedIndex(
      pool.map((p) => p.w),
      rand,
    );
    if (idx < 0) break;
    const [{ t }] = pool.splice(idx, 1);
    const built = t.build(ctx);
    let rarity = rollRarity(rand, rarityWeights, opts.boost ?? 0);
    if (opts.minRarity) rarity = rarityAtLeast(rarity, opts.minRarity);
    out.push({ template: t, ...built, rarity });
  }
  return out;
}
