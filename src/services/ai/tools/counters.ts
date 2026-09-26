import { C } from '@/domain/counters';
import { CATEGORIES } from '@/types';

/**
 * Counters an achievement can be based on, with a plain-language meaning.
 * These are the real keys the game engine increments (see domain/counters.ts).
 */
export const COUNTER_CATALOG: { key: string; meaning: string }[] = [
  { key: C.questsCompleted, meaning: 'Quests completed (all kinds)' },
  { key: C.questsCore, meaning: 'Core quests completed' },
  { key: C.questsChallenge, meaning: 'Challenges completed' },
  { key: C.questsSide, meaning: 'Side quests completed' },
  { key: C.questsEarly, meaning: 'Quests completed early in the morning' },
  { key: C.workouts, meaning: 'Strength workouts completed' },
  { key: C.workoutSets, meaning: 'Workout sets completed' },
  { key: C.workoutsPerfect, meaning: 'Workouts with every set completed' },
  { key: C.cardioSessions, meaning: 'Cardio sessions' },
  { key: C.waterMl, meaning: 'Water logged in total (ml)' },
  { key: C.waterDays, meaning: 'Days the water target was reached' },
  { key: C.stepsTotal, meaning: 'Steps logged in total' },
  { key: C.stepsTargetDays, meaning: 'Days the step target was reached' },
  { key: C.steps10k, meaning: 'Days with 10,000+ steps' },
  { key: C.distanceKm, meaning: 'Distance logged (km)' },
  { key: C.proteinDays, meaning: 'Days the protein target was reached' },
  { key: C.calorieDays, meaning: 'Days within the calorie target' },
  { key: C.nutritionLogged, meaning: 'Days with food logged' },
  { key: C.weightLogs, meaning: 'Weigh-ins logged' },
  { key: C.sleepLogs, meaning: 'Sleep logs' },
  { key: C.daysPlayed, meaning: 'Days played' },
  { key: C.daysPerfectCore, meaning: 'Days with every core quest done' },
  { key: C.perfectCoreRunBest, meaning: 'Best run of perfect-core days in a row' },
  { key: C.daysScore80, meaning: 'Days with a score of 80+' },
  { key: C.daysScore90, meaning: 'Days with a score of 90+' },
  { key: C.leisureUnderDays, meaning: 'Days under the play-time budget' },
  { key: C.leisureUnderRunBest, meaning: 'Best run of days under the play-time budget' },
  { key: C.routinesMorning, meaning: 'Morning routines completed' },
  { key: C.routinesNight, meaning: 'Night routines completed' },
  { key: C.routinesAny, meaning: 'Routines completed' },
  { key: C.reviewsWeekly, meaning: 'Weekly reviews done' },
  { key: C.prsTotal, meaning: 'Personal records set' },
  { key: C.buildingUpgrades, meaning: 'Tycoon room upgrades' },
  { key: C.level, meaning: 'Player level' },
  { key: C.xpTotal, meaning: 'Total XP' },
  { key: C.coinsEarned, meaning: 'Coins earned in total' },
  { key: C.streakCurrent, meaning: 'Current daily streak' },
  { key: C.streakLongest, meaning: 'Longest daily streak' },
  { key: C.homeLevel, meaning: 'Home level (sum of room levels)' },
];

const PREFIXES = ['cat.', 'actStreak.', 'stats.'];

export function isKnownCounter(key: string): boolean {
  if (COUNTER_CATALOG.some((c) => c.key === key)) return true;
  if (key.startsWith('cat.')) return (CATEGORIES as readonly string[]).includes(key.slice(4));
  return PREFIXES.some((p) => key.startsWith(p) && key.length > p.length) || (Object.values(C) as unknown[]).includes(key);
}
