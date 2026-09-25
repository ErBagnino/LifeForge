import { z } from 'zod';
import type { MealItem } from '@/types';
import { callTool } from './ai/claude';

/** Downscale a photo to a JPEG data URL (keeps IndexedDB and uploads small). */
export async function downscale(file: Blob, maxSide: number, quality = 0.72): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read the photo.'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const Item = z.object({
  name: z.string().min(1).max(60),
  grams: z.number().min(0).max(3000).optional(),
  kcal: z.number().min(0).max(4000),
  protein: z.number().min(0).max(300),
  carbs: z.number().min(0).max(600),
  fat: z.number().min(0).max(300),
});
const Estimate = z.object({
  meal_name: z.string().max(60),
  items: z.array(Item).min(1).max(12),
  confidence: z.enum(['low', 'medium', 'high']),
  note: z.string().max(200).optional(),
});
export type FoodEstimate = z.infer<typeof Estimate>;

const SYSTEM = [
  'You estimate the nutrition of a meal from a photo for a personal food log.',
  'List the visible foods with realistic portion sizes (grams) and kcal/protein/carbs/fat per item, using standard nutrition tables.',
  'Be neutral and practical: never judge the meal, never suggest skipping meals, fasting or compensating with exercise.',
  'If the image is not food, return a single item named "Not food" with zeros and confidence low.',
].join('\n');

/** Optional AI estimate from a photo (only with the player's own key). The player reviews everything before logging. */
export async function estimateFromPhoto(dataUrl: string, model: string, hint?: string): Promise<FoodEstimate> {
  const [meta, data] = dataUrl.split(',');
  const media = (/image\/(jpeg|png|webp)/.exec(meta)?.[0] ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';
  const raw = await callTool<unknown>({
    model,
    system: SYSTEM,
    maxTokens: 800,
    content: [
      { type: 'image', source: { type: 'base64', media_type: media, data } },
      { type: 'text', text: hint ? `Context from the user: ${hint}` : 'Estimate this meal.' },
    ],
    tool: { name: 'log_meal', description: 'Structured nutrition estimate for the meal in the photo.', input_schema: z.toJSONSchema(Estimate) as Record<string, unknown> },
  });
  const parsed = Estimate.safeParse(raw);
  if (!parsed.success) throw new Error('The estimate came back in an unexpected format. Enter the values manually.');
  return parsed.data;
}

export function roundItem(i: MealItem): MealItem {
  return { ...i, kcal: Math.round(i.kcal), protein: Math.round(i.protein), carbs: Math.round(i.carbs), fat: Math.round(i.fat), grams: i.grams !== undefined ? Math.round(i.grams) : undefined };
}
