import type { MealItem } from '@/types';

export interface FoodPreset extends MealItem {
  id: string;
  icon: string;
  portion: string;
}

/**
 * Quick-add foods with typical values per portion (approximate, from common
 * nutrition tables). Everything is editable before logging.
 */
export const FOOD_PRESETS: FoodPreset[] = [
  { id: 'yogurt', icon: '🥛', name: 'Greek yogurt 0%', portion: '170 g', grams: 170, kcal: 100, protein: 17, carbs: 6, fat: 0 },
  { id: 'whey', icon: '🥤', name: 'Protein shake', portion: '30 g + water', grams: 30, kcal: 120, protein: 24, carbs: 3, fat: 2 },
  { id: 'chicken', icon: '🍗', name: 'Chicken breast', portion: '150 g cooked', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5 },
  { id: 'eggs', icon: '🥚', name: 'Eggs', portion: '2 large', grams: 100, kcal: 143, protein: 13, carbs: 1, fat: 10 },
  { id: 'tuna', icon: '🐟', name: 'Tuna (in water)', portion: '1 can, 80 g', grams: 80, kcal: 90, protein: 20, carbs: 0, fat: 1 },
  { id: 'bresaola', icon: '🥩', name: 'Bresaola', portion: '50 g', grams: 50, kcal: 76, protein: 16, carbs: 0, fat: 1 },
  { id: 'cottage', icon: '🧀', name: 'Cottage cheese', portion: '150 g', grams: 150, kcal: 135, protein: 17, carbs: 5, fat: 5 },
  { id: 'pasta', icon: '🍝', name: 'Pasta', portion: '100 g dry', grams: 100, kcal: 355, protein: 12, carbs: 72, fat: 2 },
  { id: 'rice', icon: '🍚', name: 'Rice', portion: '100 g dry', grams: 100, kcal: 350, protein: 7, carbs: 78, fat: 1 },
  { id: 'bread', icon: '🍞', name: 'Bread', portion: '50 g', grams: 50, kcal: 130, protein: 4, carbs: 25, fat: 1 },
  { id: 'oats', icon: '🥣', name: 'Oats', portion: '50 g', grams: 50, kcal: 190, protein: 7, carbs: 32, fat: 3 },
  { id: 'banana', icon: '🍌', name: 'Banana', portion: '1 medium', grams: 120, kcal: 105, protein: 1, carbs: 27, fat: 0 },
  { id: 'apple', icon: '🍎', name: 'Apple', portion: '1 medium', grams: 180, kcal: 95, protein: 0, carbs: 25, fat: 0 },
  { id: 'oil', icon: '🫒', name: 'Olive oil', portion: '1 tbsp', grams: 10, kcal: 90, protein: 0, carbs: 0, fat: 10 },
  { id: 'veg', icon: '🥗', name: 'Mixed vegetables', portion: '200 g', grams: 200, kcal: 60, protein: 3, carbs: 10, fat: 0 },
  { id: 'pizza', icon: '🍕', name: 'Pizza margherita', portion: '1 pizza', grams: 350, kcal: 800, protein: 32, carbs: 100, fat: 28 },
];

export function sumItems(items: MealItem[]): Pick<MealItem, 'kcal' | 'protein' | 'carbs' | 'fat'> {
  return items.reduce((s, i) => ({ kcal: s.kcal + i.kcal, protein: s.protein + i.protein, carbs: s.carbs + i.carbs, fat: s.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}
