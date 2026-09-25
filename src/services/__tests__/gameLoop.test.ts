import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbInstance, questRepository, playerRepository, statsRepository, achievementRepository, tycoonRepository, settingsRepository, metaRepository } from '@/repositories';
import { ensureSeeded } from '../seedService';
import { beginAdventure, closeDay, ensureToday, setDayType } from '../game/dayService';
import { completeQuest, loadDay, skipQuest, snoozeQuest, uncompleteQuest } from '../game/questService';
import { getLeisureTimer, logMetric, startLeisure, stopLeisure } from '../metricsService';
import { buyCosmetic, buildOrUpgrade } from '../tycoonService';
import { exportData, importData, validateImport } from '../exportService';
import { finishSession, startSession, saveSession, decideSuggestion } from '../workoutService';
import { parseAiResponse, buildAiPrompt } from '../aiImportService';
import { clock } from '../clock';
import type { Rpe } from '@/types';

let dbCounter = 0;
async function freshGame(dateIso = '2026-09-21T10:00:00') {
  resetDbInstance(`lifeforge-test-${++dbCounter}`);
  clock.setOffset(new Date(dateIso).getTime() - Date.now());
  await ensureSeeded();
  await beginAdventure();
}

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
