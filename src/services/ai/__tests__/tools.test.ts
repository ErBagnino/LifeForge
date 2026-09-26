import { beforeEach, describe, expect, it } from 'vitest';
import { activityRepository, getDb, metaRepository, playerRepository, questRepository, resetDbInstance, settingsRepository, statsRepository, workoutRepository } from '@/repositories';
import { ensureSeeded } from '../../seedService';
import { beginAdventure } from '../../game/dayService';
import { clock } from '../../clock';
import { recentChanges, undoChange } from '../changeLog';
import { execute, missingImplementations, prepare, runRead, validateCall, type PreparedAction } from '../tools/registry';
import { RESET_PHRASE } from '../../resetService';

let n = 0;
async function fresh() {
  resetDbInstance(`lifeforge-tools-${++n}`);
  clock.setOffset(new Date('2026-09-23T09:00:00').getTime() - Date.now()); // Wednesday
  await ensureSeeded();
  await metaRepository.set('adventureStart', '2026-09-01');
  await beginAdventure();
}

async function action(name: string, args: Record<string, unknown>): Promise<PreparedAction> {
  const p = await prepare({ name, args });
  if (!p.ok) throw new Error(p.result.message);
  if (p.kind !== 'action') throw new Error('expected an action');
  return p.action;
}

describe('AI tool registry', () => {
  beforeEach(fresh);

  it('implements every declared tool', () => {
    expect(missingImplementations()).toEqual([]);
  });

  it('logFood logs a real meal (meal type from the time) only after APPLY; logWater adds water', async () => {
    const a = await action('logFood', { name: 'Pizza margherita', time: '20:30', kcal: 820, protein: 33, carbs: 101, fat: 28 });
    expect(JSON.stringify(a)).toMatch(/Dinner · 20:30/);
    expect(await getDb().meals.count()).toBe(0); // nothing written before confirmation
    const { result: r } = await execute(a, { source: 'gemini' });
    expect(r.success).toBe(true);
    const [meal] = await getDb().meals.toArray();
    expect(meal).toMatchObject({ name: 'Pizza margherita', mealType: 'dinner', kcal: 820, source: 'ai' });
    expect((await statsRepository.getLog('2026-09-23'))?.metrics.calories).toBe(820);
    const { result: w } = await execute(await action('logWater', { ml: 500 }), { source: 'gemini' });
    expect(w.success).toBe(true);
    expect((await statsRepository.getLog('2026-09-23'))?.metrics.water).toBe(500);
    // Both can be undone from the chat; totals go back through the normal services.
    expect(r.undoable && w.undoable).toBe(true);
    expect((await undoChange(w.changeId!)).success).toBe(true);
    expect((await undoChange(r.changeId!)).success).toBe(true);
    expect(await getDb().meals.count()).toBe(0);
    const after = (await statsRepository.getLog('2026-09-23'))?.metrics;
    expect(after?.calories ?? 0).toBe(0);
    expect(after?.water ?? 0).toBe(0);
    expect(validateCall({ name: 'logFood', args: { name: 'x', kcal: -5, protein: 0, carbs: 0, fat: 0 } }).ok).toBe(false);
  });

  it('rejects invalid arguments before anything runs', async () => {
    expect(validateCall({ name: 'updateWaterGoal', args: { targetMl: 'lots' } }).ok).toBe(false);
    expect(validateCall({ name: 'nope', args: {} }).ok).toBe(false);
    const p = await prepare({ name: 'scheduleOneTimeActivity', args: { title: 'Dentist', date: '2026-09-20', durationMin: 60, category: 'general' } });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.result).toMatchObject({ success: false });
    if (!p.ok) expect(p.result.message).toMatch(/past/);
  });

  it('read tools return real data with ids', async () => {
    const r = await runRead({ name: 'getToday', args: {} });
    expect(r.success).toBe(true);
    const data = r.data as { date: string; quests: { id: string }[] };
    expect(data.date).toBe('2026-09-23');
    expect(data.quests.length).toBeGreaterThan(0);
    const counters = await runRead({ name: 'getAchievementCounters', args: {} });
    expect((counters.data as { counters: { key: string }[] }).counters.some((c) => c.key === 'workouts.completed')).toBe(true);
  });

  it('one-time activity: preview says one time, nothing saved before confirm, undo removes it', async () => {
    const a = await action('scheduleOneTimeActivity', { title: 'Dentist', date: '2026-09-25', time: '15:00', durationMin: 60, category: 'personal_care' });
    expect(a.permission).toBe('write');
    expect(a.lines.find((l) => l.label === 'Type')?.after).toMatch(/One time only/);
    expect((await questRepository.byDate('2026-09-25')).some((q) => q.title === 'Dentist')).toBe(false);
    const { result } = await execute(a, { source: 'gemini' });
    expect(result.success).toBe(true);
    const saved = (await questRepository.byDate('2026-09-25')).find((q) => q.title === 'Dentist');
    expect(saved).toMatchObject({ scheduledTime: '15:00', source: 'coach', kind: 'manual' });
    expect((await activityRepository.all()).some((x) => x.name === 'Dentist')).toBe(false); // not recurring
    const undo = await undoChange(result.changeId!);
    expect(undo.success).toBe(true);
    expect(await questRepository.get(saved!.id)).toBeUndefined();
  });

  it('recurring activity is created as a library activity with weekdays', async () => {
    const a = await action('createActivity', { name: 'Guitar', category: 'productivity', priority: 'optional', recurrence: { type: 'weekdays', days: [1, 3] }, durationMin: 30 });
    expect(a.lines[0]).toMatchObject({ label: 'Repeats', after: 'Every Mon, Wed' });
    const { result } = await execute(a, { source: 'gemini' });
    expect(result.success).toBe(true);
    const act = (await activityRepository.all()).find((x) => x.name === 'Guitar');
    expect(act?.recurrence).toEqual({ type: 'weekdays', days: [1, 3] });
    const bad = await prepare({ name: 'createActivity', args: { name: 'X', category: 'general', priority: 'optional', recurrence: { type: 'weekdays' }, durationMin: 5 } });
    expect(bad.ok).toBe(false);
  });

  it('nutrition targets respect safety bounds and change gradually, with before → after', async () => {
    const s = (await settingsRepository.get())!;
    expect((await prepare({ name: 'updateNutritionTargets', args: { calories: 900 } })).ok).toBe(s.safety.calorieMin <= 900);
    expect(s.nutrition.calories + s.safety.calorieMaxAdjust).toBeLessThan(s.safety.calorieMax);
    const a = await action('updateNutritionTargets', { calories: s.safety.calorieMax });
    expect(a.warnings.join(' ')).toMatch(/gradually/);
    const line = a.lines.find((l) => l.label.startsWith('Calories'))!;
    expect(line.before).toBe(String(s.nutrition.calories));
    expect(Number(line.after)).toBe(s.nutrition.calories + s.safety.calorieMaxAdjust);
    const { result } = await execute(a, { source: 'gemini' });
    expect(result.success).toBe(true);
    expect((await settingsRepository.get())!.nutrition.calories).toBe(s.nutrition.calories + s.safety.calorieMaxAdjust);
    await undoChange(result.changeId!);
    expect((await settingsRepository.get())!.nutrition.calories).toBe(s.nutrition.calories);
  });

  it('achievement for N workouts uses a real counter; unknown counters are refused', async () => {
    expect((await prepare({ name: 'createAchievement', args: { name: 'Iron 20', description: '20 workouts', counter: 'made.up', threshold: 20 } })).ok).toBe(false);
    const a = await action('createAchievement', { name: 'Iron 20', description: 'Complete 20 workouts', counter: 'workouts.completed', threshold: 20 });
    expect(a.lines[1].after).toBe('0 / 20');
    await execute(a, { source: 'gemini' });
    const ach = (await getDb().achievements.toArray()).find((x) => x.name === 'Iron 20');
    expect(ach?.condition).toEqual({ type: 'counter', key: 'workouts.completed', gte: 20 });
  });

  it('workout edits and the weight safety cap', async () => {
    const plan = (await workoutRepository.activePlan())!;
    const t = plan.templates[0];
    const ex = t.exercises[0];
    const state = (await workoutRepository.states.get(ex.exerciseId))!;
    const a = await action('updateExerciseParameters', { templateId: t.id, exerciseId: ex.exerciseId, workingWeight: state.workingWeight * 3 + 10 });
    expect(a.warnings.join(' ')).toMatch(/capped/);
    await execute(a, { source: 'gemini' });
    expect((await workoutRepository.states.get(ex.exerciseId))!.workingWeight).toBeLessThan(state.workingWeight * 3);
    const rm = await action('removeWorkoutExercise', { templateId: t.id, exerciseId: ex.exerciseId });
    const { result } = await execute(rm, { source: 'gemini' });
    expect((await workoutRepository.activePlan())!.templates[0].exercises.some((e) => e.exerciseId === ex.exerciseId)).toBe(false);
    await undoChange(result.changeId!);
    expect((await workoutRepository.activePlan())!.templates[0].exercises.some((e) => e.exerciseId === ex.exerciseId)).toBe(true);
  });

  it('completeQuest is low-risk and undo takes the rewards back through the engine', async () => {
    const q = (await questRepository.byDate('2026-09-23')).find((x) => x.status === 'pending' && !x.target)!;
    const xpBefore = (await playerRepository.get())!.xp;
    const a = await action('completeQuest', { questId: q.id });
    expect(a.permission).toBe('low');
    const { result } = await execute(a, { source: 'gemini' });
    expect(result.success).toBe(true);
    const xpAfter = (await playerRepository.get())!.xp;
    expect(xpAfter).toBeGreaterThan(xpBefore);
    const earned = (await questRepository.get(q.id))!.earned!.xp;
    expect((await undoChange(result.changeId!)).success).toBe(true);
    expect((await questRepository.get(q.id))!.status).toBe('pending');
    // The quest's own reward is taken back (achievements unlocked on the way stay unlocked).
    expect(xpAfter - (await playerRepository.get())!.xp).toBe(earned);
  });

  it('game rules show before → after and refuse unknown paths', async () => {
    expect((await prepare({ name: 'updateGameRules', args: { changes: [{ path: 'xp.nope', value: 3 }] } })).ok).toBe(false);
    const rules = (await runRead({ name: 'getGameRules', args: { section: 'streak' } })).data as { rules: Record<string, number> };
    const [path, value] = Object.entries(rules.rules)[0];
    const a = await action('updateGameRules', { changes: [{ path, value: value + 1 }] });
    expect(a.lines[0]).toEqual({ label: path, before: String(value), after: String(value + 1) });
  });

  it('full reset needs the exact typed phrase', async () => {
    const a = await action('resetAllData', {});
    expect(a.permission).toBe('destructive');
    expect(a.confirmPhrase).toBe(RESET_PHRASE);
    expect(a.undoable).toBe(false);
    const denied = await execute(a, { source: 'gemini', typedPhrase: 'reset everything' });
    expect(denied.result.success).toBe(false);
    expect(await settingsRepository.get()).toBeDefined();
    const ok = await execute(a, { source: 'gemini', typedPhrase: RESET_PHRASE });
    expect(ok.result.success).toBe(true);
    expect(await settingsRepository.get()).toBeUndefined();
  });

  it('reset today removes today’s XP and quests but keeps settings', async () => {
    const q = (await questRepository.byDate('2026-09-23')).find((x) => x.status === 'pending' && !x.target)!;
    await execute(await action('completeQuest', { questId: q.id }), { source: 'gemini' });
    const xpDone = (await playerRepository.get())!.xp;
    expect(xpDone).toBeGreaterThan(0);
    const r = await execute(await action('resetToday', {}), { source: 'gemini' });
    expect(r.result.success).toBe(true);
    expect((await playerRepository.get())!.xp).toBeLessThan(xpDone);
    expect((await questRepository.byDate('2026-09-23')).every((x) => x.status === 'pending')).toBe(true);
    expect((await recentChanges()).some((c) => c.tool === 'resetToday')).toBe(false); // not undoable → not in the undo log
  });
});
