import type { ActivityCategory, Building, Cosmetic, CosmeticType, ISODate } from '@/types';

/**
 * World events and collections. Events are reactions of the house to what the player
 * really did this week (or the real calendar) — never random, never paid. Collections are
 * sets completed by building rooms, buying cosmetics with earned coins and growing mastery.
 * No loot boxes, no chance, no timers that punish.
 */

export interface WorldEventInput {
  date: ISODate;
  /** Weekday 0–6 (Sunday = 0) of `date`. */
  weekday: number;
  streak: number;
  /** Last 7 game days (today included). */
  week: { workouts: number; waterDays: number; activeDays: number; successDays: number; /** Game days of the window that exist (new players have fewer than 7). */ days?: number };
  /** Completed quests per category, last 7 days. */
  categories: Partial<Record<ActivityCategory, number>>;
  buildings: Pick<Building, 'id' | 'level'>[];
}

export interface WorldEvent {
  id: string;
  icon: string;
  title: string;
  text: string;
  /** Room that shows the event (ambient highlight), if any. */
  room?: string;
  /** Why it is happening, in one line. */
  because: string;
}

const built = (input: WorldEventInput, id: string) => (input.buildings.find((b) => b.id === id)?.level ?? 0) > 0;

export function worldEvents(input: WorldEventInput): WorldEvent[] {
  const out: WorldEvent[] = [];
  const c = (k: ActivityCategory) => input.categories[k] ?? 0;
  if (input.streak >= 7) out.push({ id: 'lantern_festival', icon: '🏮', title: 'Lantern Festival', text: 'Lanterns glow in every room to celebrate your streak.', because: `${input.streak}-day streak` });
  if (input.week.workouts >= 3) out.push({ id: 'gym_buzz', icon: '🏋️', title: 'The gym is buzzing', text: built(input, 'gym') ? 'Your gym hums with energy this week.' : 'Your training has the neighbours talking — build the gym to show it off.', room: 'gym', because: `${input.week.workouts} workouts in the last 7 days` });
  if (input.week.waterDays >= 5) out.push({ id: 'garden_bloom', icon: '🌸', title: 'The garden is in bloom', text: 'Well-watered, like you.', room: 'garden', because: `water target hit on ${input.week.waterDays} of the last 7 days` });
  if (c('reading') + c('online_learning') >= 3) out.push({ id: 'library_night', icon: '🕯️', title: 'Late night at the library', text: 'Candles stay lit for your reading streak.', room: 'library', because: `${c('reading') + c('online_learning')} reading/learning quests this week` });
  if (c('cleaning') + c('home') + c('order') >= 4) out.push({ id: 'spotless', icon: '✨', title: 'Spotless house', text: 'Everything sparkles. Even the basement.', because: `${c('cleaning') + c('home') + c('order')} home quests this week` });
  if (c('animal_care') >= 5) out.push({ id: 'happy_pet', icon: '🐾', title: 'A very happy pet', text: 'Your companion is curled up in the sunniest spot.', because: `${c('animal_care')} pet-care quests this week` });
  if (input.weekday === 0 || input.weekday === 6) out.push({ id: 'weekend_market', icon: '🧺', title: 'Weekend market', text: 'Stalls pop up outside. A good day to spend some coins in the shop.', because: 'it’s the weekend' });
  if (!out.length && (input.week.days ?? 7) >= 5 && input.week.activeDays <= 1) out.push({ id: 'quiet_house', icon: '🕊️', title: 'A quiet week', text: 'The house waits patiently. Nothing is lost — one small quest wakes it up.', because: 'few active days lately' });
  return out.slice(0, 3);
}

export interface Collection {
  id: string;
  icon: string;
  title: string;
  description: string;
  items: { id: string; icon: string; label: string; owned: boolean }[];
  owned: number;
  total: number;
  complete: boolean;
}

const COSMETIC_SETS: { id: string; title: string; icon: string; types: CosmeticType[] }[] = [
  { id: 'wardrobe', title: 'Wardrobe', icon: '👕', types: ['outfit'] },
  { id: 'hairstyles', title: 'Hairstyles', icon: '💇', types: ['hair', 'hairColor'] },
  { id: 'decor', title: 'Home décor', icon: '🪴', types: ['decoration'] },
];

function collection(id: string, icon: string, title: string, description: string, items: Collection['items']): Collection {
  const owned = items.filter((i) => i.owned).length;
  return { id, icon, title, description, items, owned, total: items.length, complete: items.length > 0 && owned === items.length };
}

export function worldCollections(input: { buildings: Pick<Building, 'id' | 'name' | 'icon' | 'level' | 'maxLevel'>[]; cosmetics: Pick<Cosmetic, 'id' | 'name' | 'icon' | 'type' | 'owned' | 'value' | 'price'>[]; mastery: { id: string; label: string; icon: string; level: number }[] }): Collection[] {
  const out: Collection[] = [
    collection('rooms', '🏠', 'Every room', 'Build each room of the house.', input.buildings.map((b) => ({ id: b.id, icon: b.icon, label: b.name, owned: b.level > 0 }))),
    collection('max_rooms', '🏰', 'Master builder', 'Bring every room to its top level.', input.buildings.map((b) => ({ id: b.id, icon: b.icon, label: `${b.name} ${b.level}/${b.maxLevel}`, owned: b.level >= b.maxLevel }))),
    collection('mastery_badges', '🌿', 'Mastery badges', 'Reach mastery 5 in every life track.', input.mastery.map((t) => ({ id: t.id, icon: t.icon, label: t.label, owned: t.level >= 5 }))),
  ];
  for (const set of COSMETIC_SETS) {
    // Free starter items are not collectibles: only things bought with earned coins count.
    const items = input.cosmetics.filter((c) => set.types.includes(c.type) && c.price > 0);
    if (items.length) out.push(collection(set.id, set.icon, set.title, 'Buy them in the shop with coins you earned.', items.map((c) => ({ id: c.id, icon: c.type === 'decoration' ? c.value : c.icon, label: c.name, owned: c.owned }))));
  }
  return out;
}
