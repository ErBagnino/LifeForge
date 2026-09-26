import { z } from 'zod';

/**
 * Structured food estimate returned by Gemini (shared by the serverless API and the app).
 * Everything here is an estimate: quantities are approximate and the app always shows
 * them as such. Only relative imports / zod: this file is bundled into the server too.
 */

export const FOOD_UNITS = ['g', 'ml', 'piece', 'slice', 'tbsp', 'tsp', 'cup'] as const;
export const COOKING_METHODS = ['grilled', 'fried', 'baked', 'boiled', 'steamed', 'roasted', 'sauteed', 'raw', 'mixed', 'unknown'] as const;
export const CONFIDENCE = ['low', 'medium', 'high'] as const;

export const FoodItemSchema = z.object({
  name: z.string().min(1).max(60).describe('Food name in the language of the user message, singular, e.g. "Chicken breast"'),
  estimatedQuantity: z.number().min(0).max(3000).describe('Approximate amount, rounded (e.g. 150, not 147)'),
  unit: z.enum(FOOD_UNITS),
  calories: z.number().min(0).max(5000),
  protein: z.number().min(0).max(400),
  carbs: z.number().min(0).max(800),
  fat: z.number().min(0).max(400),
  confidence: z.enum(CONFIDENCE),
  cookingMethod: z.enum(COOKING_METHODS).describe('Only when visible or clearly inferable, otherwise "unknown"'),
  note: z.string().max(120).optional().describe('Short assumption about this item, e.g. "cooked weight"'),
});

export const FoodQuestionSchema = z.object({
  id: z.string().min(1).max(30),
  text: z.string().min(1).max(140).describe('A short question whose answer would change the estimate, e.g. "How much oil did you use?"'),
  options: z.array(z.string().min(1).max(24)).min(2).max(5).describe('Quick answers, e.g. ["None", "1 tsp", "1 tbsp", "2 tbsp"]'),
});

export const FoodEstimateSchema = z.object({
  isFood: z.boolean().describe('False when the image does not show food or drink'),
  mealName: z.string().max(60),
  foods: z.array(FoodItemSchema).max(15),
  mealTotals: z.object({ calories: z.number().min(0), protein: z.number().min(0), carbs: z.number().min(0), fat: z.number().min(0) }),
  overallConfidence: z.enum(CONFIDENCE),
  plateContext: z.string().max(140).optional().describe('What was used to judge portion size (plate size, utensils, item count)'),
  assumptions: z.array(z.string().max(140)).max(8),
  unknowns: z.array(z.string().max(140)).max(6).describe('Things that cannot be seen, e.g. oil, dressing, sugar'),
  questions: z.array(FoodQuestionSchema).max(3),
  changeSummary: z.string().max(200).optional().describe('After a correction: what changed, in one sentence'),
});

export type FoodItemEstimate = z.infer<typeof FoodItemSchema>;
export type FoodQuestion = z.infer<typeof FoodQuestionSchema>;
export type FoodEstimate = z.infer<typeof FoodEstimateSchema>;

/** Totals are always recomputed from the items by the app, never trusted from the model. */
export function sumFoods(foods: Pick<FoodItemEstimate, 'calories' | 'protein' | 'carbs' | 'fat'>[]): FoodEstimate['mealTotals'] {
  const t = foods.reduce((s, f) => ({ calories: s.calories + f.calories, protein: s.protein + f.protein, carbs: s.carbs + f.carbs, fat: s.fat + f.fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  return { calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}

/** "~150 g": round to a sensible precision so estimates never look exact. */
export function approxQuantity(q: number, unit: string): string {
  const r = unit === 'g' || unit === 'ml' ? (q >= 50 ? Math.round(q / 10) * 10 : Math.round(q / 5) * 5) : Math.round(q * 2) / 2;
  return `~${r}${unit === 'g' || unit === 'ml' ? ' ' + unit : ` ${unit}${r === 1 || unit === 'tbsp' || unit === 'tsp' ? '' : 's'}`}`;
}

export const FoodRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('analyze'),
    image: z.object({ mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(4_000_000) }),
    note: z.string().max(300).optional(),
    locale: z.string().max(10).optional(),
  }),
  z.object({
    mode: z.literal('revise'),
    estimate: FoodEstimateSchema,
    message: z.string().min(1).max(500),
    locale: z.string().max(10).optional(),
  }),
  z.object({
    mode: z.literal('explain'),
    estimate: FoodEstimateSchema,
    question: z.string().min(1).max(300),
    locale: z.string().max(10).optional(),
  }),
]);
export type FoodRequest = z.infer<typeof FoodRequestSchema>;

// ——— Tolerant normalisation of the model's reply (limits are enforced here, not in the schema) ———

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : undefined);
const num = (v: unknown, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Bring a model reply into FoodEstimateSchema's bounds: clamp numbers, trim strings, cap list
 * lengths, map unknown enum values to safe defaults and drop items without a name. It never
 * invents foods or values; an empty or non-object reply stays invalid and is rejected by zod.
 */
export function coerceEstimate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  const foods = list(r.foods)
    .map(obj)
    .map((f) => {
      const name = str(f.name, 60);
      if (!name) return undefined;
      const note = str(f.note, 120);
      return {
        name,
        estimatedQuantity: num(f.estimatedQuantity, 3000),
        unit: pick(f.unit, FOOD_UNITS, 'g'),
        calories: num(f.calories, 5000),
        protein: num(f.protein, 400),
        carbs: num(f.carbs, 800),
        fat: num(f.fat, 400),
        confidence: pick(f.confidence, CONFIDENCE, 'medium'),
        cookingMethod: pick(f.cookingMethod, COOKING_METHODS, 'unknown'),
        ...(note ? { note } : {}),
      };
    })
    .filter((f): f is NonNullable<typeof f> => !!f)
    .slice(0, 15);
  const questions = list(r.questions)
    .map(obj)
    .map((q, i) => {
      const text = str(q.text, 140);
      const options = list(q.options).map((o) => str(o, 24)).filter((o): o is string => !!o).slice(0, 5);
      return text && options.length >= 2 ? { id: str(q.id, 30) ?? `q${i + 1}`, text, options } : undefined;
    })
    .filter((q): q is NonNullable<typeof q> => !!q)
    .slice(0, 3);
  const strings = (v: unknown, n: number) => list(v).map((s) => str(s, 140)).filter((s): s is string => !!s).slice(0, n);
  const plateContext = str(r.plateContext, 140);
  const changeSummary = str(r.changeSummary, 200);
  return {
    isFood: typeof r.isFood === 'boolean' ? r.isFood : foods.length > 0,
    mealName: str(r.mealName, 60) ?? foods[0]?.name ?? '',
    foods,
    mealTotals: sumFoods(foods),
    overallConfidence: pick(r.overallConfidence, CONFIDENCE, 'medium'),
    ...(plateContext ? { plateContext } : {}),
    assumptions: strings(r.assumptions, 8),
    unknowns: strings(r.unknowns, 6),
    questions,
    ...(changeSummary ? { changeSummary } : {}),
  };
}
