import { z } from 'zod';

/**
 * The LifeForge tool catalogue: what the AI may read and do.
 * Shared by the serverless API (to declare functions to Gemini) and by the app
 * (to validate arguments before anything runs). Only zod + relative imports.
 *
 * Permission levels decide the confirmation the app asks for:
 * - read:        executed automatically, no changes
 * - low:         small reversible action, applied with an Undo button
 * - write:       preview + explicit confirmation
 * - destructive: strong confirmation (typed phrase for a full reset)
 */

export type Permission = 'read' | 'low' | 'write' | 'destructive';

const Iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date as YYYY-MM-DD');
const Hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('Time as HH:MM (24h)');
const Id = z.string().min(1).max(80);
const Title = z.string().min(1).max(60);

export const CATEGORY_IDS = [
  'body', 'fitness', 'cardio', 'nutrition', 'hydration', 'personal_care', 'skincare', 'home', 'cleaning', 'order',
  'animal_care', 'productivity', 'reading', 'online_learning', 'rest', 'sleep', 'social', 'outdoor', 'mental_wellbeing', 'general',
] as const;
const Category = z.enum(CATEGORY_IDS);
const Priority = z.enum(['core', 'important', 'optional']).describe('core = essential, important = useful, optional = extra');
const Weekday = z.number().int().min(0).max(6).describe('0 = Sunday … 6 = Saturday');
const Difficulty = z.number().int().min(1).max(5);

const Recurrence = z.object({
  type: z.enum(['daily', 'weekdays', 'timesPerWeek', 'everyNDays']),
  days: z.array(Weekday).max(7).optional().describe('For type "weekdays"'),
  times: z.number().int().min(1).max(7).optional().describe('For type "timesPerWeek"'),
  n: z.number().int().min(2).max(30).optional().describe('For type "everyNDays"'),
});

const OneTime = z.object({
  title: Title,
  date: Iso,
  time: Hm.optional(),
  durationMin: z.number().int().min(1).max(600),
  category: Category,
  priority: Priority.optional(),
  xp: z.number().int().min(5).max(2000).optional().describe('Leave empty to let the game engine compute it'),
  coins: z.number().int().min(0).max(1000).optional(),
  energyCost: z.number().int().min(-30).max(60).optional(),
  notes: z.string().max(200).optional(),
  icon: z.string().max(4).optional().describe('One emoji'),
});

const WorkDay = z.object({
  weekday: Weekday,
  kind: z.enum(['work', 'off', 'unknown']),
  start: Hm.optional(),
  end: Hm.optional(),
  breakMin: z.number().int().min(0).max(240).optional(),
  approximate: z.boolean().optional(),
});

export interface ToolDef {
  name: string;
  permission: Permission;
  description: string;
  schema: z.ZodObject;
}

const t = (name: string, permission: Permission, description: string, schema: z.ZodObject): ToolDef => ({ name, permission, description, schema });
const none = z.object({});

export const TOOL_DEFS: ToolDef[] = [
  // ——— Read ———
  t('getPlayerProfile', 'read', 'Player profile: name, level, XP, coins, HP, energy, class, stats, goals, body data and what is set / not set.', none),
  t('getToday', 'read', "Today's board: quests with ids, status, tier and time; score; load; capacity; energy.", none),
  t('getQuests', 'read', 'Quests for a date (default today), with ids.', z.object({ date: Iso.optional(), status: z.enum(['pending', 'completed', 'skipped', 'all']).optional() })),
  t('getActivities', 'read', 'Activity library (recurring templates that create quests), with ids. Optional text/category filter.', z.object({ query: z.string().max(40).optional(), category: Category.optional() })),
  t('getGoals', 'read', 'Active goals (multi-day goal quests) with ids and progress.', none),
  t('getWorkoutPlan', 'read', 'Workout plan: templates (ids, names, weekday) and exercises with sets, reps, rest and working weight.', none),
  t('getExercises', 'read', 'Exercise database with ids (to add exercises to a workout).', z.object({ query: z.string().max(40).optional() })),
  t('getWorkoutHistory', 'read', 'Recent workout sessions.', z.object({ limit: z.number().int().min(1).max(20).optional() })),
  t('getNutritionToday', 'read', "Today's calories/macros/water vs targets and meals.", none),
  t('getNutritionHistory', 'read', 'Daily calories/protein/water for the last N days.', z.object({ days: z.number().int().min(1).max(30).optional() })),
  t('getSteps', 'read', 'Daily steps for the last N days and the step targets.', z.object({ days: z.number().int().min(1).max(30).optional() })),
  t('getCalendar', 'read', 'Per-day score, success and completed quests between two dates (max 31 days).', z.object({ from: Iso, to: Iso })),
  t('getRoutines', 'read', 'Routines with ids and their activities.', none),
  t('getStreaks', 'read', 'Daily/weekly streak, freezes and revives, per-activity streaks.', none),
  t('getAchievements', 'read', 'Achievements with ids, condition and reward.', z.object({ filter: z.enum(['all', 'unlocked', 'locked', 'custom']).optional() })),
  t('getAchievementCounters', 'read', 'Counters an achievement condition can use (key, meaning, current value). Call before createAchievement.', none),
  t('getTycoonWorld', 'read', 'Rooms (ids, level, next cost, unlock level), home level and world bonuses.', none),
  t('getEnergy', 'read', 'Energy and HP now, and what affects them.', none),
  t('getStats', 'read', 'Stats, class affinities, lifetime totals.', none),
  t('getSchedule', 'read', 'Work schedule (regular week, upcoming versions, one-off days), availability exceptions, load mode, wake/sleep.', none),
  t('getDailyScore', 'read', 'Score breakdown for a date (default today).', z.object({ date: Iso.optional() })),
  t('getWeeklySummary', 'read', 'This week: average score, XP, coins, workouts, steps, strongest/weakest areas.', none),
  t('getGameRules', 'read', 'Current game rules (numbers) for a section, with their paths for updateGameRules.', z.object({ section: z.enum(['score', 'xp', 'coins', 'level', 'energy', 'hp', 'penalties', 'generator', 'streak']).optional() })),
  t('getDailyContext', 'read', "Where the player is in their day: state (morning/working/post-work/evening…), wake-up time, today's work session, minutes available before bed, what still matters (prioritized) and learned habits. Fields the player didn't provide are 'unknown' — ask, don't guess.", none),
  t('getChangeHistory', 'read', 'Recent changes made through the Coach (for undo questions).', z.object({ limit: z.number().int().min(1).max(20).optional() })),

  // ——— Quests & one-time activities ———
  t('scheduleOneTimeActivity', 'write', 'Add a ONE-TIME activity on a specific date (never recurring). Use for "tomorrow…", "on Friday…", "on 21 February…".', OneTime),
  t('createQuest', 'write', 'Create a one-time quest on a date (like scheduleOneTimeActivity). type "challenge" makes it a challenge.', OneTime.extend({ type: z.enum(['quest', 'challenge']).optional() })),
  t('createChallenge', 'write', 'Create a challenge for a date. Read today/energy first; keep it realistic for the available time.', z.object({ title: Title, date: Iso, durationMin: z.number().int().min(5).max(240), difficulty: Difficulty, category: Category, description: z.string().max(200).optional(), time: Hm.optional() })),
  t('updateQuest', 'write', 'Change a quest (title, date, time, duration, priority, rewards, notes).', z.object({ questId: Id, title: Title.optional(), date: Iso.optional(), time: Hm.optional(), durationMin: z.number().int().min(1).max(600).optional(), priority: Priority.optional(), xp: z.number().int().min(5).max(2000).optional(), coins: z.number().int().min(0).max(1000).optional(), notes: z.string().max(200).optional() })),
  t('deleteQuest', 'write', 'Delete a quest that is not completed.', z.object({ questId: Id })),
  t('rescheduleActivity', 'write', 'Move a quest to another date and/or time.', z.object({ questId: Id, date: Iso.optional(), time: Hm.optional() })),
  t('completeQuest', 'low', 'Mark a quest as completed (grants its rewards through the game engine).', z.object({ questId: Id })),
  t('skipQuest', 'low', 'Skip a quest for today.', z.object({ questId: Id, reason: z.enum(['tired', 'no_time', 'sick', 'not_needed', 'other']).optional() })),


  // ——— Food & water log ———
  t('logFood', 'write', 'Log something the player ate or drank (a meal or snack) with your best estimate of calories and macros. Say it is an estimate; the player reviews it before it is logged. mealType defaults from the time.', z.object({ name: Title, mealType: z.enum(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'night_snack']).optional(), time: Hm.optional(), kcal: z.number().min(0).max(5000), protein: z.number().min(0).max(400), carbs: z.number().min(0).max(800), fat: z.number().min(0).max(400) })),
  t('logWater', 'write', 'Log water the player drank today (ml).', z.object({ ml: z.number().int().min(50).max(3000) })),
  // ——— Recurring activities & routines ———
  t('createActivity', 'write', 'Create a RECURRING activity ("every Monday", "3 times a week", "daily").', z.object({ name: Title, category: Category, priority: Priority, recurrence: Recurrence, durationMin: z.number().int().min(1).max(600), preferredTime: Hm.optional(), difficulty: Difficulty.optional(), quantity: z.number().min(0).max(100000).optional(), unit: z.string().max(12).optional(), description: z.string().max(200).optional(), icon: z.string().max(4).optional(), xp: z.number().int().min(5).max(2000).optional(), coins: z.number().int().min(0).max(1000).optional() })),
  t('updateActivity', 'write', 'Change an activity (use getActivities for the id).', z.object({ activityId: Id, name: Title.optional(), category: Category.optional(), priority: Priority.optional(), recurrence: Recurrence.optional(), durationMin: z.number().int().min(1).max(600).optional(), preferredTime: Hm.optional(), difficulty: Difficulty.optional(), active: z.boolean().optional(), description: z.string().max(200).optional(), xp: z.number().int().min(5).max(2000).optional(), coins: z.number().int().min(0).max(1000).optional() })),
  t('deleteActivity', 'write', 'Delete an activity from the library.', z.object({ activityId: Id })),
  t('createRoutine', 'write', 'Create a routine from existing activity ids.', z.object({ name: Title, kind: z.enum(['morning', 'night', 'workout', 'recovery', 'custom']), activityIds: z.array(Id).min(1).max(12), startTime: Hm.optional(), icon: z.string().max(4).optional(), bonusXp: z.number().int().min(0).max(300).optional() })),
  t('updateRoutine', 'write', 'Change a routine.', z.object({ routineId: Id, name: Title.optional(), activityIds: z.array(Id).min(1).max(12).optional(), startTime: Hm.optional(), active: z.boolean().optional() })),
  t('deleteRoutine', 'write', 'Delete a routine.', z.object({ routineId: Id })),

  // ——— Goals & achievements ———
  t('createGoal', 'write', 'Create a multi-day goal with a measurable target.', z.object({ title: Title, type: z.enum(['workouts', 'metricSum', 'metricDays', 'completeCount', 'scoreDays', 'perfectCoreDays']), target: z.number().min(1).max(1000000), metric: z.enum(['steps', 'water', 'protein', 'calories', 'distance', 'workoutMinutes']).optional(), category: Category.optional(), minScore: z.number().int().min(1).max(100).optional(), endDate: Iso, startDate: Iso.optional(), xp: z.number().int().min(10).max(5000).optional(), coins: z.number().int().min(0).max(2000).optional() })),
  t('updateGoal', 'write', 'Change a goal (title, target, end date, rewards).', z.object({ goalId: Id, title: Title.optional(), target: z.number().min(1).max(1000000).optional(), endDate: Iso.optional(), xp: z.number().int().min(10).max(5000).optional(), coins: z.number().int().min(0).max(2000).optional() })),
  t('deleteGoal', 'write', 'Delete a goal.', z.object({ goalId: Id })),
  t('createAchievement', 'write', 'Create a custom achievement unlocked when a counter reaches a threshold (call getAchievementCounters first).', z.object({ name: Title, description: z.string().min(1).max(140), counter: z.string().min(1).max(60), threshold: z.number().int().min(1).max(1000000), icon: z.string().max(4).optional(), xp: z.number().int().min(0).max(5000).optional(), coins: z.number().int().min(0).max(2000).optional(), tier: z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(), hidden: z.boolean().optional() })),
  t('updateAchievement', 'write', 'Change an achievement (name, description, threshold, rewards, icon).', z.object({ achievementId: Id, name: Title.optional(), description: z.string().max(140).optional(), threshold: z.number().int().min(1).max(1000000).optional(), xp: z.number().int().min(0).max(5000).optional(), coins: z.number().int().min(0).max(2000).optional(), icon: z.string().max(4).optional() })),
  t('deleteAchievement', 'write', 'Delete an achievement.', z.object({ achievementId: Id })),

  // ——— Targets ———
  t('updateNutritionTargets', 'write', 'Change daily calorie and macro targets (within the safety bounds).', z.object({ calories: z.number().int().min(800).max(6000).optional(), protein: z.number().int().min(20).max(400).optional(), carbs: z.number().int().min(0).max(800).optional(), fat: z.number().int().min(10).max(300).optional() })),
  t('updateWeightGoal', 'write', 'Change body goal and/or target weight.', z.object({ goal: z.enum(['lose', 'maintain', 'gain']).optional(), targetWeightKg: z.number().min(35).max(250).optional(), currentWeightKg: z.number().min(35).max(250).optional() })),
  t('updateStepGoal', 'write', 'Change the daily step targets.', z.object({ ideal: z.number().int().min(1000).max(40000), min: z.number().int().min(500).max(40000).optional(), stretch: z.number().int().min(1000).max(60000).optional() })),
  t('updateWaterGoal', 'write', 'Change the daily water target (ml).', z.object({ targetMl: z.number().int().min(500).max(6000), glassMl: z.number().int().min(100).max(1000).optional() })),

  // ——— Workouts ———
  t('updateWorkout', 'write', 'Change a workout template (name, weekday or null for flexible, estimated minutes).', z.object({ templateId: Id, name: Title.optional(), weekday: Weekday.nullable().optional(), estimatedMin: z.number().int().min(10).max(240).optional() })),
  t('addWorkoutExercise', 'write', 'Add an exercise to a workout template (use getExercises for ids).', z.object({ templateId: Id, exerciseId: Id, sets: z.number().int().min(1).max(10).optional(), repMin: z.number().int().min(1).max(100).optional(), repMax: z.number().int().min(1).max(100).optional(), restSec: z.number().int().min(0).max(600).optional(), position: z.number().int().min(0).max(30).optional() })),
  t('removeWorkoutExercise', 'write', 'Remove an exercise from a workout template.', z.object({ templateId: Id, exerciseId: Id })),
  t('updateExerciseParameters', 'write', 'Change sets, rep range, rest or working weight of an exercise in a template. Weight increases follow the safety cap.', z.object({ templateId: Id, exerciseId: Id, sets: z.number().int().min(1).max(10).optional(), repMin: z.number().int().min(1).max(100).optional(), repMax: z.number().int().min(1).max(100).optional(), restSec: z.number().int().min(0).max(600).optional(), workingWeight: z.number().min(0).max(500).optional() })),

  // ——— Schedule ———
  t('setWorkSchedule', 'write', 'Set the regular work week. Only include times the user said; leave unknown ones out.', z.object({ days: z.array(WorkDay).min(1).max(7), effectiveFrom: Iso.optional(), variable: z.boolean().optional() })),
  t('setOneOffWorkDay', 'write', 'Work info for ONE date only ("tomorrow I work 10–20", "Friday off"). The regular week is unchanged.', z.object({ date: Iso, kind: z.enum(['work', 'off', 'unknown']), start: Hm.optional(), end: Hm.optional() })),
  t('setWorkScheduleUnknown', 'write', 'The user does not know their work schedule yet.', none),
  t('addAvailabilityException', 'write', 'Time-boxed availability: no_gym, more_time, less_time, keep_all (never trim quests), push (more quests).', z.object({ kind: z.enum(['no_gym', 'more_time', 'less_time', 'keep_all', 'push']), from: Iso, to: Iso.optional(), note: z.string().max(60).optional() })),
  t('setLoadMode', 'write', 'How full days are handled from now on: auto (balance), keep_all, push.', z.object({ mode: z.enum(['auto', 'keep_all', 'push']) })),
  t('updateDailyRhythm', 'write', 'Set wake-up and/or bedtime.', z.object({ wake: Hm.optional(), sleep: Hm.optional() })),

  // ——— Game rules ———
  t('updateGameRules', 'write', 'Change numeric game rules by path (see getGameRules), e.g. "xp.streakBonusPerDay".', z.object({ changes: z.array(z.object({ path: z.string().min(3).max(80), value: z.number() })).min(1).max(8) })),
  t('updateBuildingCosts', 'write', 'Change Tycoon room prices: one room or all ("all"), by multiplier or explicit base cost / growth.', z.object({ buildingId: z.string().min(1).max(40), multiplier: z.number().min(0.2).max(5).optional(), baseCost: z.number().int().min(10).max(100000).optional(), costGrowth: z.number().min(1).max(10).optional() })),

  // ——— Resets ———
  t('resetToday', 'destructive', "Undo today's progress: today's quests, logs, meals and the XP/coins earned today.", none),
  t('resetWeek', 'destructive', "Undo this week's progress (days, quests, logs, meals, XP/coins earned this week).", none),
  t('resetWorkoutHistory', 'destructive', 'Delete workout sessions and exercise records; working weights back to the starting values.', none),
  t('resetNutritionHistory', 'destructive', 'Delete meals and calorie/macro/water logs.', none),
  t('resetGameProgress', 'destructive', 'Reset game progress (level, XP, coins, HP, streaks, achievements, Tycoon, inventory). History (logs, workouts, meals) is kept.', none),
  t('resetAllData', 'destructive', 'Delete EVERYTHING and start over from onboarding. Ask first whether the user wants only game progress reset.', none),
];

export const TOOL_BY_NAME: Record<string, ToolDef> = Object.fromEntries(TOOL_DEFS.map((d) => [d.name, d]));

/** JSON Schema for Gemini `parametersJsonSchema` (no $schema, no additionalProperties noise). */
export function toolJsonSchema(def: ToolDef): Record<string, unknown> {
  return cleanSchema(z.toJSONSchema(def.schema, { io: 'input' }) as Record<string, unknown>);
}

export function cleanSchema(node: unknown): Record<string, unknown> {
  if (Array.isArray(node)) return node.map(cleanSchema) as unknown as Record<string, unknown>;
  if (!node || typeof node !== 'object') return node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema' || k === 'additionalProperties' || k === 'pattern') continue;
    out[k] = typeof v === 'object' ? cleanSchema(v) : v;
  }
  return out;
}

/** Context snapshot sent with each chat request (kept short to save quota). */
export const ChatRequestSchema = z.object({
  contents: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        parts: z.array(z.record(z.string(), z.unknown())).min(1).max(40),
      }),
    )
    .min(1)
    .max(40),
  context: z.string().max(12_000),
  personality: z.enum(['gentle', 'balanced', 'direct', 'hard']).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
