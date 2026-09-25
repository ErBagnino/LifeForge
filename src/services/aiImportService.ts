import { z } from 'zod';
import { CATEGORY_INFO } from '@/data/categories';
import type { Activity, ActivityCategory, Recurrence } from '@/types';
import { CATEGORIES, STAT_KEYS } from '@/types';
import { slugify, uid } from '@/utils/id';

const CATEGORY_ALIASES: Record<string, ActivityCategory> = {
  knowledge: 'online_learning',
  learning: 'online_learning',
  study: 'online_learning',
  education: 'online_learning',
  books: 'reading',
  book: 'reading',
  health: 'body',
  exercise: 'fitness',
  gym: 'fitness',
  sport: 'fitness',
  running: 'cardio',
  walking: 'cardio',
  food: 'nutrition',
  diet: 'nutrition',
  water: 'hydration',
  selfcare: 'personal_care',
  self_care: 'personal_care',
  hygiene: 'personal_care',
  skin: 'skincare',
  house: 'home',
  chores: 'cleaning',
  tidy: 'order',
  organization: 'order',
  organisation: 'order',
  pet: 'animal_care',
  pets: 'animal_care',
  animals: 'animal_care',
  work: 'productivity',
  focus: 'productivity',
  relax: 'rest',
  recovery: 'rest',
  friends: 'social',
  family: 'social',
  nature: 'outdoor',
  mind: 'mental_wellbeing',
  mental: 'mental_wellbeing',
  mindfulness: 'mental_wellbeing',
  wellbeing: 'mental_wellbeing',
  other: 'general',
};

export function normalizeCategory(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const key = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((CATEGORIES as readonly string[]).includes(key)) return key;
  return CATEGORY_ALIASES[key] ?? CATEGORY_ALIASES[key.replace(/_/g, '')] ?? key;
}

const UNIT_ALIASES: Record<string, string> = { minutes: 'min', minute: 'min', mins: 'min', seconds: 'sec', litres: 'ml', liters: 'ml' };

/** Schema the external AI must follow. Also exported as JSON Schema inside the prompt. */
export const AiActivitySchema = z.object({
  name: z.string().trim().min(2).max(60),
  icon: z.string().max(8).optional().describe('One emoji'),
  category: z.preprocess(normalizeCategory, z.enum(CATEGORIES)),
  description: z.string().max(300).optional(),
  frequency: z.number().int().min(0).max(7).optional().describe('Times per week. 7 = daily, 0 = optional side quest (not scheduled)'),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('Fixed weekdays, 0 = Sunday … 6 = Saturday'),
  unit: z.preprocess((u) => (typeof u === 'string' ? (UNIT_ALIASES[u.toLowerCase()] ?? u) : u), z.string().max(20)).optional(),
  quantity: z.number().positive().max(100000).optional(),
  durationMin: z.number().int().min(1).max(240).optional(),
  difficulty: z.number().int().min(1).max(5).describe('1 trivial · 2 easy · 3 medium · 4 hard · 5 boss'),
  importance: z.enum(['core', 'important', 'optional']).optional(),
  timeOfDay: z.enum(['morning', 'midday', 'afternoon', 'evening', 'night', 'anytime']).optional(),
  preferredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe('HH:mm'),
  xp: z.number().int().min(5).max(1000).optional(),
  coins: z.number().int().min(0).max(500).optional(),
  stats: z.partialRecord(z.enum(STAT_KEYS), z.number().int().min(0).max(5)).optional(),
  notes: z.string().max(300).optional(),
});
export type AiActivity = z.infer<typeof AiActivitySchema>;

export const AiImportSchema = z.union([
  z.array(AiActivitySchema).min(1).max(30),
  z.object({ activities: z.array(AiActivitySchema).min(1).max(30) }),
  AiActivitySchema,
]);

const UNSAFE_PATTERNS = [
  /\bfast(ing)?\b/i,
  /skip(ping)?\s+(a\s+)?(meal|breakfast|lunch|dinner)/i,
  /\bno\s+(food|eating|meals?)\b/i,
  /\bstarv/i,
  /\bpurg/i,
  /\b[1-9]\d{2}\s?kcal\b/i,
  /\b(sleep less|no sleep|all[-\s]?nighter)\b/i,
  /\bpunish/i,
  /\bexercise until\b/i,
];

export interface ImportDraft {
  activity: Activity;
  warnings: string[];
}

export interface ParseResult {
  drafts: ImportDraft[];
  errors: string[];
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found. Paste the JSON returned by the AI.');
  const candidate = body.slice(start);
  const lastBrace = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  return JSON.parse(candidate.slice(0, lastBrace + 1));
}

function recurrenceFrom(a: AiActivity): Recurrence {
  if (a.weekdays?.length) return { type: 'weekdays', days: [...new Set(a.weekdays)] };
  const f = a.frequency ?? 0;
  if (f >= 7) return { type: 'daily' };
  if (f <= 0) return { type: 'pool' };
  return { type: 'timesPerWeek', times: f };
}

export function toActivity(a: AiActivity, existingIds: Set<string>, now = Date.now()): ImportDraft {
  const warnings: string[] = [];
  const text = `${a.name} ${a.description ?? ''} ${a.notes ?? ''}`;
  if (UNSAFE_PATTERNS.some((p) => p.test(text))) {
    warnings.push('Looks like a restriction / deprivation / punishment mechanic. LifeForge never rewards these — edit it or import only if it is truly your informed choice.');
  }
  let id = `ai_${slugify(a.name)}`;
  if (existingIds.has(id)) id = `${id}_${uid().slice(-4)}`;
  existingIds.add(id);
  const recurrence = recurrenceFrom(a);
  const tier = a.importance ?? (recurrence.type === 'pool' ? 'optional' : 'important');
  const activity: Activity = {
    id,
    name: a.name,
    icon: a.icon || CATEGORY_INFO[a.category].icon,
    category: a.category,
    description: a.description,
    tier,
    importance: tier === 'core' ? 5 : tier === 'important' ? 4 : 2,
    difficulty: a.difficulty as Activity['difficulty'],
    recurrence,
    timeOfDay: a.timeOfDay ?? 'anytime',
    preferredTime: a.preferredTime,
    durationMin: a.durationMin ?? (a.unit === 'min' && a.quantity ? a.quantity : 10),
    quantity: a.quantity,
    unit: a.unit,
    baseXp: a.xp,
    baseCoins: a.coins,
    stats: a.stats ?? { ...CATEGORY_INFO[a.category].stats },
    adaptive: false,
    active: true,
    streakEligible: recurrence.type !== 'pool',
    generatorEligible: recurrence.type === 'pool',
    userCreated: true,
    aiImported: true,
    notes: a.notes,
    createdAt: now,
    updatedAt: now,
  };
  if (a.xp && a.xp > 400 && a.difficulty < 4) warnings.push('XP looks high for the difficulty — the centralized formula is usually a better guide.');
  return { activity, warnings };
}

/** Parse, validate and convert pasted AI output into activity drafts. */
export function parseAiResponse(text: string, existingIds: string[]): ParseResult {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (e) {
    return { drafts: [], errors: [e instanceof Error ? e.message : 'Invalid JSON'] };
  }
  const parsed = AiImportSchema.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 12).map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`);
    return { drafts: [], errors };
  }
  const list = Array.isArray(parsed.data) ? parsed.data : 'activities' in parsed.data ? parsed.data.activities : [parsed.data];
  const ids = new Set(existingIds);
  return { drafts: list.map((a) => toActivity(a, ids)), errors: [] };
}

export interface PromptContext {
  request: string;
  existingNames: string[];
  petName: string;
  count: number;
}

/** A structured prompt for ChatGPT / Claude / any AI. No API is called. */
export function buildAiPrompt(ctx: PromptContext): string {
  const schema = z.toJSONSchema(z.array(AiActivitySchema), { io: 'input' });
  return [
    `You are helping me design activities for LifeForge, a personal life RPG where real-life activities become quests.`,
    ``,
    `MY REQUEST: ${ctx.request.trim() || 'Suggest a few useful new activities for my routine.'}`,
    ``,
    `Create ${ctx.count} activit${ctx.count === 1 ? 'y' : 'ies'}. Return ONLY a JSON array (no prose, no markdown) that validates against this JSON Schema:`,
    JSON.stringify(schema, null, 2),
    ``,
    `Rules:`,
    `- category must be one of: ${CATEGORIES.join(', ')}.`,
    `- difficulty: 1 trivial (1–5 min), 2 easy, 3 medium, 4 hard, 5 boss-level.`,
    `- XP guideline (optional field): trivial 10–20, easy 20–50, medium 50–100, hard 100–200, boss 250+. Coins ≈ 30% of XP.`,
    `- frequency = times per week (7 = daily, 0 = optional side quest).`,
    `- Realistic for someone who may work 10 hours a day. Small, concrete, measurable.`,
    `- Safety: never propose fasting, skipping meals, extreme restriction, punitive exercise, sleep deprivation or anything risky.`,
    `- My pet is called ${ctx.petName}.`,
    ctx.existingNames.length ? `- Avoid duplicates of what I already have: ${ctx.existingNames.slice(0, 60).join('; ')}.` : '',
    ``,
    `Example of one item:`,
    JSON.stringify({ name: 'Read online', icon: '📰', category: 'reading', frequency: 3, unit: 'min', quantity: 15, durationMin: 15, difficulty: 2, xp: 40, coins: 15 }),
  ]
    .filter((l) => l !== '')
    .join('\n');
}
