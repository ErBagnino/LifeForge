import type { Building, DayLog, MetricType, Player, Quest } from '@/types';
import type { Counters } from './achievements';

/**
 * Counter keys. Incremental counters are persisted; derived counters are computed
 * from current state at evaluation time. Achievements reference both by key.
 */
export const C = {
  questsCompleted: 'quests.completed',
  questsCore: 'quests.core',
  questsImportant: 'quests.important',
  questsOptional: 'quests.optional',
  questsSide: 'quests.side',
  questsChallenge: 'quests.challenge',
  questsHidden: 'quests.hidden',
  questsWeekly: 'quests.weekly',
  questsBoss: 'quests.boss',
  questsRare: 'quests.rare',
  questsEpic: 'quests.epic',
  questsLegendary: 'quests.legendary',
  questsEarly: 'quests.early',
  questsLate: 'quests.late',
  questsWeekend: 'quests.weekend',
  cat: (category: string) => `cat.${category}`,
  /** Best consecutive-completion streak for one activity. */
  actStreak: (activityId: string) => `actStreak.${activityId}`,
  workouts: 'workouts.completed',
  workoutSets: 'workouts.sets',
  workoutVolume: 'workouts.volume',
  workoutsPerfect: 'workouts.perfect',
  cardioSessions: 'cardio.sessions',
  cardioRuns: 'cardio.runs',
  waterMl: 'water.ml',
  stepsTotal: 'steps.total',
  steps10k: 'steps.days10k',
  stepsTargetDays: 'steps.targetDays',
  distanceKm: 'distance.km',
  daysPlayed: 'days.played',
  daysPerfectCore: 'days.perfectCore',
  perfectCoreRun: 'days.perfectCoreRun',
  perfectCoreRunBest: 'days.perfectCoreRunBest',
  daysScore80: 'days.score80',
  daysScore90: 'days.score90',
  daysScore100: 'days.score100',
  daysAllTiers: 'days.allTiers',
  waterDays: 'water.targetDays',
  proteinDays: 'protein.targetDays',
  calorieDays: 'calories.targetDays',
  nutritionLogged: 'nutrition.loggedDays',
  weightLogs: 'weight.logs',
  sleepLogs: 'sleep.logs',
  restDays: 'rest.days',
  recoveryExits: 'recovery.exits',
  knockouts: 'recovery.knockouts',
  snoozes: 'snooze.total',
  skips: 'skip.total',
  rerolls: 'reroll.total',
  prsTotal: 'prs.total',
  prsWeight: 'prs.weight',
  prsSteps: 'prs.steps',
  buildingsBuilt: 'world.built',
  buildingUpgrades: 'world.upgrades',
  decorations: 'world.decorations',
  cosmetics: 'cosmetics.owned',
  shopPurchases: 'shop.purchases',
  freezesUsed: 'freeze.used',
  revivesUsed: 'revive.used',
  rewardsRedeemed: 'rewards.redeemed',
  reviewsDaily: 'reviews.daily',
  reviewsWeekly: 'reviews.weekly',
  activitiesCreated: 'activities.created',
  aiImported: 'ai.imported',
  routinesMorning: 'routine.morning',
  routinesNight: 'routine.night',
  routinesAny: 'routine.any',
  timelineEdits: 'timeline.edits',
  // derived
  level: 'level',
  xpTotal: 'xp.total',
  coinsBalance: 'coins.balance',
  coinsEarned: 'coins.earned',
  coinsSpent: 'coins.spent',
  streakCurrent: 'streak.current',
  streakLongest: 'streak.longest',
  weeklyStreak: 'streak.weekly',
  homeLevel: 'world.homeLevel',
  maxBuildingLevel: 'world.maxBuildingLevel',
  stat: (key: string) => `stats.${key}`,
} as const;

function add(out: Counters, key: string, n = 1) {
  out[key] = (out[key] ?? 0) + n;
}

/** Counter increments for one quest completion. */
export function countersForQuest(quest: Quest, completedAt: number): Counters {
  const out: Counters = {};
  add(out, C.questsCompleted);
  add(out, C.cat(quest.category));
  add(out, quest.tier === 'core' ? C.questsCore : quest.tier === 'important' ? C.questsImportant : C.questsOptional);
  const kindKey: Partial<Record<Quest['kind'], string>> = {
    side: C.questsSide,
    challenge: C.questsChallenge,
    hidden: C.questsHidden,
    weekly: C.questsWeekly,
    boss: C.questsBoss,
  };
  const k = kindKey[quest.kind];
  if (k) add(out, k);
  if (quest.rarity === 'rare') add(out, C.questsRare);
  if (quest.rarity === 'epic') add(out, C.questsEpic);
  if (quest.rarity === 'legendary') add(out, C.questsLegendary);
  const d = new Date(completedAt);
  const h = d.getHours();
  if (h >= 4 && h < 7) add(out, C.questsEarly);
  if (h >= 23 || h < 4) add(out, C.questsLate);
  if (d.getDay() === 0 || d.getDay() === 6) add(out, C.questsWeekend);
  return out;
}

/** Counter increments when a metric entry is logged (delta = change of the day total). */
export function countersForMetric(type: MetricType, delta: number): Counters {
  const out: Counters = {};
  if (type === 'water' && delta > 0) add(out, C.waterMl, delta);
  if (type === 'steps' && delta > 0) add(out, C.stepsTotal, delta);
  if (type === 'distance' && delta > 0) add(out, C.distanceKm, delta);
  if (type === 'weight') add(out, C.weightLogs);
  if (type === 'sleep') add(out, C.sleepLogs);
  return out;
}

export interface DayCloseCounterInput {
  log: DayLog;
  perfectCore: boolean;
  allTiers: boolean;
  stepsIdeal: number;
  waterTarget: number;
  proteinTarget: number;
  calorieTarget: number;
  previousPerfectRun: number;
  previousPerfectRunBest: number;
}

/** Counter increments/sets applied when a day closes. Returns increments and absolute sets. */
export function countersForDayClose(input: DayCloseCounterInput): { inc: Counters; set: Counters } {
  const inc: Counters = {};
  const set: Counters = {};
  const m = input.log.metrics;
  add(inc, C.daysPlayed);
  if (input.perfectCore) add(inc, C.daysPerfectCore);
  if (input.allTiers) add(inc, C.daysAllTiers);
  if (input.log.score >= 80) add(inc, C.daysScore80);
  if (input.log.score >= 90) add(inc, C.daysScore90);
  if (input.log.score >= 100) add(inc, C.daysScore100);
  if ((m.steps ?? 0) >= 10000) add(inc, C.steps10k);
  if ((m.steps ?? 0) >= input.stepsIdeal) add(inc, C.stepsTargetDays);
  if ((m.water ?? 0) >= input.waterTarget) add(inc, C.waterDays);
  if ((m.protein ?? 0) >= input.proteinTarget * 0.9) add(inc, C.proteinDays);
  if (m.calories && Math.abs(m.calories - input.calorieTarget) / input.calorieTarget <= 0.1) add(inc, C.calorieDays);
  if (m.calories || m.protein) add(inc, C.nutritionLogged);
  if (input.log.restDay) add(inc, C.restDays);
  const run = input.perfectCore ? input.previousPerfectRun + 1 : 0;
  set[C.perfectCoreRun] = run;
  set[C.perfectCoreRunBest] = Math.max(run, input.previousPerfectRunBest);
  return { inc, set };
}

/** Counters derived from live state (never stored). */
export function derivedCounters(player: Player, buildings: Building[], level: number): Counters {
  const out: Counters = {
    [C.level]: level,
    [C.xpTotal]: player.xp,
    [C.coinsBalance]: player.coins,
    [C.coinsEarned]: player.lifetime.coinsEarned,
    [C.coinsSpent]: player.lifetime.coinsSpent,
    [C.streakCurrent]: player.streak.current,
    [C.streakLongest]: player.streak.longest,
    [C.weeklyStreak]: player.streak.weekly.longest,
    [C.homeLevel]: buildings.reduce((s, b) => s + b.level, 0),
    [C.maxBuildingLevel]: buildings.reduce((m, b) => Math.max(m, b.level), 0),
  };
  for (const [k, v] of Object.entries(player.stats)) out[C.stat(k)] = v;
  return out;
}

export function mergeCounters(...maps: Counters[]): Counters {
  const out: Counters = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) out[k] = v;
  return out;
}
