import { type FoodEstimate, type FoodItemEstimate, sumFoods } from '@/ai/shared/food';
import type { MealItem } from '@/types';
import { geminiProvider } from './ai/gemini';

/**
 * Food vision. Photos are compressed on the device, sent to the app's own serverless
 * API and from there to Gemini for an estimate. They are never stored on the server,
 * and on the device only when "Save Food Photos" is on (a small thumbnail).
 */

export interface CompressedImage {
  mimeType: 'image/jpeg';
  /** Base64 without the data: prefix. */
  data: string;
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
}

const MAX_SIDE = 1280;
const TARGET_BYTES = 900_000;

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read the photo. Try another one.'));
      i.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function draw(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4);

/** Resize to ≤1280 px and re-encode as JPEG, lowering quality until it is under ~0.9 MB. */
export async function compressImage(file: Blob, maxSide = MAX_SIDE, targetBytes = TARGET_BYTES): Promise<CompressedImage> {
  const img = await loadImage(file);
  let side = maxSide;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = draw(img, side);
    for (const q of [0.82, 0.72, 0.6, 0.5]) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const bytes = base64Bytes(data);
      if (bytes <= targetBytes) return { mimeType: 'image/jpeg', data, dataUrl, bytes, width: canvas.width, height: canvas.height };
    }
    side = Math.round(side * 0.75);
  }
  throw new Error('This photo is too large to analyze. Try another one.');
}

/** Small JPEG kept with the meal only when "Save Food Photos" is on. */
export async function thumbnail(file: Blob, maxSide = 320): Promise<string> {
  return draw(await loadImage(file), maxSide).toDataURL('image/jpeg', 0.7);
}

/** Kept for other screens that downscale images. */
export async function downscale(file: Blob, maxSide: number, quality = 0.72): Promise<string> {
  return draw(await loadImage(file), maxSide).toDataURL('image/jpeg', quality);
}

// ——— Gemini calls (cached: the same photo/correction is never sent twice) ———

const cache = new Map<string, unknown>();
function remember<T>(key: string, value: T): T {
  cache.set(key, value);
  if (cache.size > 20) cache.delete(cache.keys().next().value!);
  return value;
}

async function hash(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
}

export function foodLocale(voiceLang?: string): string {
  return (voiceLang || (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en').slice(0, 5);
}

export async function analyzeMeal(image: CompressedImage, opts: { note?: string; locale: string; signal?: AbortSignal }): Promise<FoodEstimate> {
  const key = `a:${await hash(image.data)}:${opts.note ?? ''}:${opts.locale}`;
  if (cache.has(key)) return cache.get(key) as FoodEstimate;
  const r = await geminiProvider.analyzeFood({ mode: 'analyze', image: { mimeType: image.mimeType, data: image.data }, note: opts.note || undefined, locale: opts.locale }, opts.signal);
  return remember(key, r.estimate);
}

/** Apply a correction or an answer ("it was turkey", "1 tbsp of oil"). Only the estimate JSON is sent — not the photo. */
export async function reviseMeal(estimate: FoodEstimate, message: string, opts: { locale: string; signal?: AbortSignal }): Promise<FoodEstimate> {
  const key = `r:${await hash(JSON.stringify(estimate.foods) + message)}`;
  if (cache.has(key)) return cache.get(key) as FoodEstimate;
  const r = await geminiProvider.reviseFood({ mode: 'revise', estimate, message: message.slice(0, 500), locale: opts.locale }, opts.signal);
  return remember(key, r.estimate);
}

export async function explainMeal(estimate: FoodEstimate, question: string, opts: { locale: string; signal?: AbortSignal }): Promise<string> {
  const key = `e:${await hash(JSON.stringify(estimate.foods) + question)}`;
  if (cache.has(key)) return cache.get(key) as string;
  const r = await geminiProvider.explainFood({ mode: 'explain', estimate, question: question.slice(0, 300), locale: opts.locale }, opts.signal);
  return remember(key, r.text);
}

// ——— Local editing (no AI needed) ———

/** Change an item's quantity and scale its macros proportionally. */
export function scaleFood(f: FoodItemEstimate, quantity: number): FoodItemEstimate {
  const k = f.estimatedQuantity > 0 ? quantity / f.estimatedQuantity : 1;
  const r = (v: number) => Math.round(v * k * 10) / 10;
  return { ...f, estimatedQuantity: quantity, calories: Math.round(f.calories * k), protein: r(f.protein), carbs: r(f.carbs), fat: r(f.fat) };
}

/** Recompute totals after local edits (the app never trusts a model's sum). */
export function withTotals(e: FoodEstimate): FoodEstimate {
  return { ...e, mealTotals: sumFoods(e.foods) };
}

export function estimateToItems(e: FoodEstimate): MealItem[] {
  return e.foods.map((f) => ({
    name: f.name,
    grams: f.unit === 'g' || f.unit === 'ml' ? Math.round(f.estimatedQuantity) : undefined,
    kcal: Math.round(f.calories),
    protein: Math.round(f.protein),
    carbs: Math.round(f.carbs),
    fat: Math.round(f.fat),
  }));
}

export interface EstimateDiff {
  totals: { key: 'calories' | 'protein' | 'carbs' | 'fat'; before: number; after: number }[];
  added: string[];
  removed: string[];
  changed: { name: string; before: number; after: number }[];
}

/** Before → after of a correction, for the review screen. */
export function diffEstimates(before: FoodEstimate, after: FoodEstimate): EstimateDiff {
  const b = sumFoods(before.foods);
  const a = sumFoods(after.foods);
  const names = (e: FoodEstimate) => new Map(e.foods.map((f) => [f.name.toLowerCase(), f]));
  const bn = names(before);
  const an = names(after);
  return {
    totals: (['calories', 'protein', 'carbs', 'fat'] as const).filter((k) => b[k] !== a[k]).map((k) => ({ key: k, before: b[k], after: a[k] })),
    added: after.foods.filter((f) => !bn.has(f.name.toLowerCase())).map((f) => f.name),
    removed: before.foods.filter((f) => !an.has(f.name.toLowerCase())).map((f) => f.name),
    changed: after.foods.filter((f) => bn.has(f.name.toLowerCase()) && bn.get(f.name.toLowerCase())!.calories !== f.calories).map((f) => ({ name: f.name, before: bn.get(f.name.toLowerCase())!.calories, after: f.calories })),
  };
}

export function roundItem(i: MealItem): MealItem {
  return { ...i, kcal: Math.round(i.kcal), protein: Math.round(i.protein), carbs: Math.round(i.carbs), fat: Math.round(i.fat), grams: i.grams !== undefined ? Math.round(i.grams) : undefined };
}
