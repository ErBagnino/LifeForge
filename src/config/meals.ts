/**
 * Meal types and the clock windows used to pre-select one. The player can always pick another
 * meal; these are only defaults. Edit the start times here to tune the windows.
 */
export const MEAL_TYPES = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'night_snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_INFO: Record<MealType, { label: string; short: string; icon: string }> = {
  breakfast: { label: 'Breakfast', short: 'Breakfast', icon: '🥐' },
  morning_snack: { label: 'Morning Snack', short: 'AM snack', icon: '🍎' },
  lunch: { label: 'Lunch', short: 'Lunch', icon: '🍝' },
  afternoon_snack: { label: 'Afternoon Snack', short: 'PM snack', icon: '🥨' },
  dinner: { label: 'Dinner', short: 'Dinner', icon: '🍽️' },
  night_snack: { label: 'Night Snack', short: 'Night snack', icon: '🌙' },
};

/**
 * Local-time start of each window ("HH:MM"), in order. A time before the first start belongs to
 * the last window (so 01:00 is still a night snack).
 *   04:00–10:30 Breakfast · 10:30–12:00 Morning Snack · 12:00–15:00 Lunch
 *   15:00–18:30 Afternoon Snack · 18:30–22:30 Dinner · 22:30–04:00 Night Snack
 */
export const MEAL_WINDOWS: { type: MealType; start: string }[] = [
  { type: 'breakfast', start: '04:00' },
  { type: 'morning_snack', start: '10:30' },
  { type: 'lunch', start: '12:00' },
  { type: 'afternoon_snack', start: '15:00' },
  { type: 'dinner', start: '18:30' },
  { type: 'night_snack', start: '22:30' },
];

const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** The default meal for a moment (device local time). */
export function mealTypeAt(date: Date | number = new Date(), windows = MEAL_WINDOWS): MealType {
  const d = typeof date === 'number' ? new Date(date) : date;
  const min = d.getHours() * 60 + d.getMinutes();
  let current = windows[windows.length - 1].type;
  for (const w of windows) if (min >= toMin(w.start)) current = w.type;
  return current;
}

/** Best guess for meals saved before meal types existed (from their name, else their time). */
export function mealTypeOf(meal: { mealType?: MealType; name?: string; ts: number }): MealType {
  if (meal.mealType) return meal.mealType;
  const n = (meal.name ?? '').toLowerCase();
  if (/breakfast|colazione/.test(n)) return 'breakfast';
  if (/lunch|pranzo/.test(n)) return 'lunch';
  if (/dinner|cena/.test(n)) return 'dinner';
  return mealTypeAt(meal.ts);
}
