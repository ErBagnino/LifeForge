import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbInstance, questRepository, playerRepository, statsRepository, achievementRepository, tycoonRepository, settingsRepository, metaRepository } from '@/repositories';
import { ensureSeeded } from '../seedService';
import { beginAdventure, closeDay, ensureToday, setDayType } from '../game/dayService';
import { completeQuest, keepQuest, loadDay, skipQuest, snoozeQuest, uncompleteQuest } from '../game/questService';
import { addWorkSchedule, newSchedule, setTemporaryWork } from '../scheduleService';
import { planFor } from '../game/dayPlan';
import { deleteMeal, getLeisureTimer, logMeal, logMetric, startLeisure, stopLeisure, updateMeal } from '../metricsService';
import { buyCosmetic, buildOrUpgrade } from '../tycoonService';
import { exportData, importData, validateImport } from '../exportService';
import { finishSession, startSession, saveSession, decideSuggestion } from '../workoutService';
import { parseAiResponse, buildAiPrompt } from '../aiImportService';
import { clock } from '../clock';
import type { Rpe } from '@/types';

let dbCounter = 0;
/** `veteran` skips the first-week ramp so tests see a full board. */
async function freshGame(dateIso = '2026-09-21T10:00:00', veteran = true) {
  resetDbInstance(`lifeforge-test-${++dbCounter}`);
  clock.setOffset(new Date(dateIso).getTime() - Date.now());
  await ensureSeeded();
  if (veteran) await metaRepository.set('adventureStart', '2026-09-01');
  await beginAdventure();
}

describe('first day experience', () => {
  it('day 1 starts small: a first quest plus at most 4 core objectives, no important quests', async () => {
    await freshGame('2026-09-21T10:00:00', false);
    const { day } = await loadDay(clock.today());
    const core = day.filter((q) => q.tier === 'core' && q.kind !== 'first');
    expect(core.length).toBeGreaterThanOrEqual(3);
    expect(core.length).toBeLessThanOrEqual(4);
    expect(day.some((q) => q.tier === 'important')).toBe(false);
    expect(day.some((q) => q.kind === 'first')).toBe(true);
    // The player's own goals make the cut.
    expect(core.some((q) => q.activityId === 'nofap')).toBe(true);
    expect(core.some((q) => q.activityId === 'leisure_limit')).toBe(true);
    // Monday's workout is offered as a no-pressure bonus.
    expect(day.find((q) => q.kind === 'workout')?.tier).toBe('optional');
    const log = await statsRepository.getLog(clock.today());
    expect(log?.dayIndex).toBe(0);
  });

  it('works without a work schedule: status not set, no errors, provisional capacity', async () => {
    await freshGame('2026-09-21T10:00:00', false);
    const settings = (await settingsRepository.get())!;
    expect(settings.work.status).toBe('not_set');
    const log = await statsRepository.getLog(clock.today());
    expect(log?.workStatus).toBe('unknown');
    expect(log?.capacityMin).toBeGreaterThan(0);
  });
});

describe('game loop (IndexedDB)', () => {
  beforeEach(async () => {
    await freshGame();
  });

  it('seeds content and builds a first day with a first quest', async () => {
    const { day } = await loadDay(clock.today());
    expect(day.length).toBeGreaterThan(5);
    expect(day.some((q) => q.kind === 'first')).toBe(true);
    expect(day.some((q) => q.kind === 'workout')).toBe(true); // Monday = Upper A
    expect(day.some((q) => q.activityId === 'nofap')).toBe(true);
    expect(day.some((q) => q.activityId === 'leisure_limit')).toBe(true);
    const player = await playerRepository.get();
    expect(player).toMatchObject({ level: 1, coins: 0, hp: 100 });
  });

  it('completing the first quest grants XP, coins, FIRST BLOOD and funds the first upgrade', async () => {
    const { day } = await loadDay(clock.today());
    const first = day.find((q) => q.kind === 'first')!;
    const res = await completeQuest(first.id);
    expect(res.events.some((e) => e.type === 'questComplete')).toBe(true);
    expect(res.events.some((e) => e.type === 'achievement' && e.achievement.id === 'first_blood')).toBe(true);
    const player = (await playerRepository.get())!;
    expect(player.xp).toBeGreaterThan(50);
    expect(player.coins).toBeGreaterThanOrEqual(40);
    const buy = await buyCosmetic('deco_lamp');
    expect(buy.ok).toBe(true);
    const lamp = await tycoonRepository.cosmetics.get('deco_lamp');
    expect(lamp?.owned).toBe(true);
    const unlocked = (await achievementRepository.unlocked()).map((a) => a.id);
    expect(unlocked).toContain('home_sweet_home');
  });

  it('undo reverses a completion', async () => {
    const { day } = await loadDay(clock.today());
    const q = day.find((x) => x.kind === 'first')!;
    await completeQuest(q.id);
    const before = (await playerRepository.get())!;
    await uncompleteQuest(q.id);
    const after = (await playerRepository.get())!;
    expect(after.xp).toBeLessThan(before.xp);
    expect((await questRepository.get(q.id))?.status).toBe('pending');
  });

  it('metric logging drives quest progress and auto-completion', async () => {
    const settings = (await settingsRepository.get())!;
    await logMetric('water', 1000);
    let water = (await loadDay(clock.today())).day.find((q) => q.activityId === 'drink_water')!;
    expect(water.progress).toBe(1000);
    expect(water.status).toBe('pending');
    await logMetric('water', settings.hydration.targetMl - 1000);
    water = (await loadDay(clock.today())).day.find((q) => q.activityId === 'drink_water')!;
    expect(water.status).toBe('completed');
    const log = await statsRepository.getLog(clock.today());
    expect(log?.metrics.water).toBe(settings.hydration.targetMl);
    expect(log?.score).toBeGreaterThan(0);
  });

  it('play-time budget: timer logs minutes, exceeding fails the quest', async () => {
    await startLeisure('games');
    expect(await getLeisureTimer()).toBeDefined();
    clock.setOffset(clock.getOffset() + 30 * 60000);
    const stop = await stopLeisure();
    expect(stop.minutes).toBe(30);
    let q = (await loadDay(clock.today())).day.find((x) => x.activityId === 'leisure_limit')!;
    expect(q.progress).toBe(30);
    expect(q.status).toBe('pending');
    await logMetric('leisure', 70);
    q = (await loadDay(clock.today())).day.find((x) => x.activityId === 'leisure_limit')!;
    expect(q.status).toBe('failed');
  });

  it('play-time quest is won at day close when under budget', async () => {
    await logMetric('leisure', 45);
    const today = clock.today();
    await closeDay(today);
    const q = (await questRepository.byDate(today)).find((x) => x.activityId === 'leisure_limit')!;
    expect(q.status).toBe('completed');
  });

  it('snooze and skip update the quest', async () => {
    const { day } = await loadDay(clock.today());
    const q = day.find((x) => x.tier === 'important' && x.status === 'pending')!;
    await snoozeQuest(q.id, clock.now() + 3600000);
    expect((await questRepository.get(q.id))?.snoozeCount).toBe(1);
    await skipQuest(q.id, 'no_time');
    expect((await questRepository.get(q.id))?.status).toBe('skipped');
  });

  it('rolls over days: closes yesterday, builds today, streak updates', async () => {
    const { day } = await loadDay(clock.today());
    for (const q of day) if (q.status === 'pending' && !q.metric && !q.goal) await completeQuest(q.id);
    const s = (await settingsRepository.get())!;
    await logMetric('water', s.hydration.targetMl);
    await logMetric('steps', s.steps.ideal);
    await logMetric('protein', s.nutrition.protein);
    await logMetric('calories', s.nutrition.calories);
    const firstDay = clock.today();
    clock.setOffset(clock.getOffset() + 86400000);
    await ensureToday();
    const log = await statsRepository.getLog(firstDay);
    expect(log?.closed).toBe(true);
    expect(log?.score).toBeGreaterThan(60);
    const player = (await playerRepository.get())!;
    expect(player.streak.current).toBe(log!.success ? 1 : 0);
    expect(await metaRepository.get('currentDate')).toBe(clock.today());
    const today = await loadDay(clock.today());
    expect(today.day.length).toBeGreaterThan(5);
    expect(player.level).toBeGreaterThanOrEqual(2);
    expect(today.day.some((q) => q.kind === 'side')).toBe(true);
  });

  it('rest day removes training quests', async () => {
    const s = (await settingsRepository.get())!;
    await setDayType(clock.today(), 'rest', s);
    const { day } = await loadDay(clock.today());
    expect(day.some((q) => q.kind === 'workout' && q.status === 'pending')).toBe(false);
  });

  it('workout session: completes the workout quest and suggests progression', async () => {
    const { day } = await loadDay(clock.today());
    const quest = day.find((q) => q.kind === 'workout')!;
    const session = await startSession(quest.workoutTemplateId, quest.id);
    await saveSession({
      ...session,
      exercises: session.exercises.map((e) => ({ ...e, sets: e.sets.map((x) => ({ ...x, reps: e.repMax, completed: true, rpe: 1 as Rpe })) })),
    });
    const res = await finishSession(session.id);
    expect(res.summary?.completedSets).toBeGreaterThan(0);
    expect((await questRepository.get(quest.id))?.status).toBe('completed');
    const chest = res.summary!.session.exercises.find((e) => e.exerciseId === 'chest_press')!;
    expect(chest.suggestion?.action).toBe('increase');
    await decideSuggestion(session.id, 'chest_press', true);
    const { workoutRepository } = await import('@/repositories');
    expect((await workoutRepository.states.get('chest_press'))?.workingWeight).toBe(22.5);
  });

  it('meals feed the daily macros and can be deleted cleanly', async () => {
    const r = await logMeal({ name: 'Lunch', items: [{ name: 'Chicken', kcal: 248, protein: 46, carbs: 0, fat: 5 }, { name: 'Rice', kcal: 350, protein: 7, carbs: 78, fat: 1 }], kcal: 598, protein: 53, carbs: 78, fat: 6, source: 'preset' });
    expect(r.events).toBeDefined();
    let log = await statsRepository.getLog(clock.today());
    expect(log?.metrics).toMatchObject({ calories: 598, protein: 53, carbs: 78, fat: 6 });
    const [meal] = await statsRepository.mealsByDate(clock.today());
    expect(meal.items).toHaveLength(2);
    expect(await statsRepository.metricsByRef(meal.id)).toHaveLength(4);
    await deleteMeal(meal);
    log = await statsRepository.getLog(clock.today());
    expect(log?.metrics.calories ?? 0).toBe(0);
    expect(await statsRepository.mealsByDate(clock.today())).toHaveLength(0);
  });

  it('editing a logged meal updates the day totals in place (no duplicate entries, meal type and time kept)', async () => {
    await logMeal({ name: 'Pizza', mealType: 'dinner', ts: new Date('2026-09-21T20:15:00').getTime(), items: [{ name: 'Pizza', kcal: 800, protein: 32, carbs: 100, fat: 28 }], kcal: 800, protein: 32, carbs: 100, fat: 28, source: 'manual' });
    const [meal] = await statsRepository.mealsByDate(clock.today());
    expect(meal.mealType).toBe('dinner');
    expect(new Date(meal.ts).getHours()).toBe(20);
    await updateMeal(meal, { name: 'Half pizza', kcal: 400, protein: 16, carbs: 50, fat: 0, mealType: 'lunch' });
    const log = await statsRepository.getLog(clock.today());
    expect(log?.metrics).toMatchObject({ calories: 400, protein: 16, carbs: 50 });
    expect(log?.metrics.fat ?? 0).toBe(0);
    const refs = await statsRepository.metricsByRef(meal.id);
    expect(refs.map((r) => r.type).sort()).toEqual(['calories', 'carbs', 'protein']);
    const [edited] = await statsRepository.mealsByDate(clock.today());
    expect(edited).toMatchObject({ name: 'Half pizza', mealType: 'lunch', kcal: 400 });
    expect(edited.items[0]).toMatchObject({ name: 'Half pizza', kcal: 400 });
  });

  it('tycoon: building is blocked by level and coins', async () => {
    const r = await buildOrUpgrade('gym');
    expect(r.ok).toBe(false);
  });

  it('export → validate → import round-trip', async () => {
    const { day } = await loadDay(clock.today());
    await completeQuest(day.find((q) => q.kind === 'first')!.id);
    const file = await exportData();
    const v = validateImport(JSON.parse(JSON.stringify(file)));
    expect(v.ok).toBe(true);
    const xp = (await playerRepository.get())!.xp;
    await importData(v.file!);
    expect((await playerRepository.get())!.xp).toBe(xp);
    expect(validateImport({ foo: 1 }).ok).toBe(false);
    expect(validateImport({ ...file, data: { ...file.data, player: [{ id: 'nope' }] } }).ok).toBe(false);
  });
});

describe('schedules & load control', () => {
  beforeEach(async () => {
    await freshGame();
  });

  it('a temporary schedule changes that day only', async () => {
    const tomorrow = '2026-09-22';
    await setTemporaryWork(tomorrow, { kind: 'work', start: '10:00', end: '20:00' });
    const s = (await settingsRepository.get())!;
    expect(s.work.status).toBe('not_set');
    expect((await planFor(tomorrow, s)).work).toEqual({ start: '10:00', end: '20:00', label: 'Work' });
    expect((await planFor('2026-09-29', s)).workStatus).toBe('unknown');
  });

  it('a recurring schedule from Monday applies from that date and rebalances today', async () => {
    await addWorkSchedule(newSchedule(
      [{ kind: 'off' }, ...Array.from({ length: 5 }, () => ({ kind: 'work' as const, start: '08:00', end: '18:00' })), { kind: 'off' }],
      '2026-09-21',
      'coach',
    ));
    const s = (await settingsRepository.get())!;
    expect(s.work.status).toBe('set');
    const log = await statsRepository.getLog(clock.today());
    expect(log?.workStatus).toBe('set');
    expect(log?.freeMin).toBeGreaterThan(0);
    expect((await planFor('2026-09-26', s)).workStatus).toBe('off');
  });

  it('"Keep this task" survives a rebalance on a heavy day', async () => {
    await setTemporaryWork(clock.today(), { kind: 'work', start: '07:00', end: '21:00' });
    const lightened = (await loadDay(clock.today())).day.find((q) => q.lightened && q.status === 'pending');
    expect(lightened).toBeDefined();
    await keepQuest(lightened!.id);
    await setTemporaryWork(clock.today(), { kind: 'work', start: '07:00', end: '21:30' });
    const kept = await questRepository.get(lightened!.id);
    expect(kept).toMatchObject({ kept: true, lightened: false, tier: lightened!.baseTier });
  });

  it('a free day holds more than a 14-hour workday', async () => {
    await setTemporaryWork(clock.today(), { kind: 'work', start: '07:00', end: '21:00' });
    const heavy = (await statsRepository.getLog(clock.today()))!;
    await setTemporaryWork(clock.today(), { kind: 'off' });
    const free = (await statsRepository.getLog(clock.today()))!;
    expect(free.capacityMin!).toBeGreaterThan(heavy.capacityMin!);
    expect(heavy.workload).toBeGreaterThan(free.workload);
  });
});

describe('AI import', () => {
  it('parses the spec example (with aliases) and validates', () => {
    const r = parseAiResponse('```json\n{"name":"Read online","category":"knowledge","frequency":3,"unit":"minutes","difficulty":2,"xp":40,"coins":15}\n```', []);
    expect(r.errors).toEqual([]);
    expect(r.drafts[0].activity).toMatchObject({ category: 'online_learning', unit: 'min', baseXp: 40, baseCoins: 15, aiImported: true });
    expect(r.drafts[0].activity.recurrence).toEqual({ type: 'timesPerWeek', times: 3 });
  });

  it('reports schema errors and flags unsafe mechanics', () => {
    expect(parseAiResponse('not json', []).errors.length).toBe(1);
    expect(parseAiResponse('[{"name":"x"}]', []).errors.length).toBeGreaterThan(0);
    const r = parseAiResponse('[{"name":"Skip breakfast","category":"nutrition","difficulty":2}]', []);
    expect(r.drafts[0].warnings.length).toBe(1);
  });

  it('builds a prompt containing the JSON schema', () => {
    const p = buildAiPrompt({ request: 'Learn Spanish', existingNames: ['Read 10 minutes'], petName: 'Sky', count: 3 });
    expect(p).toContain('"$schema"');
    expect(p).toContain('Learn Spanish');
  });
});
