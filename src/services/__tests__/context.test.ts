import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, metaRepository, playerRepository, questRepository, resetDbInstance, settingsRepository, suggestionRepository } from '@/repositories';
import { ensureSeeded } from '../seedService';
import { beginAdventure } from '../game/dayService';
import { clock } from '../clock';
import { confirmWake, contextSnapshot, endWork, getDayContext, getOpenWork, learnedSchedule, recordOpen, resetLearnedSchedule, startDay, startWork, wakeNotYet, workHistory } from '../contextService';

let n = 0;
const setNow = (iso: string) => clock.setOffset(new Date(iso).getTime() - Date.now());
async function fresh() {
  resetDbInstance(`lifeforge-context-${++n}`);
  setNow('2026-09-23T07:45:00'); // Wednesday
  await ensureSeeded();
  await metaRepository.set('adventureStart', '2026-09-01');
  await beginAdventure();
}

describe('daily context service (IndexedDB)', () => {
  beforeEach(fresh);

  it('first open of the day is recorded once; the previous visit is remembered', async () => {
    await metaRepository.set('lastVisitDate', '2026-09-20');
    const a = await recordOpen();
    expect(a).toMatchObject({ firstToday: true, lastVisit: '2026-09-20' });
    expect((await recordOpen()).firstToday).toBe(false);
    expect((await getDayContext()).firstOpenAt).toBeDefined();
    const snap = await contextSnapshot();
    expect(snap?.opening).toMatchObject({ kind: 'morning', welcomeBack: true, wake: { kind: 'ask' } });
  });

  it('wake-up: YES records now, NOT YET waits, START DAY closes the opening card', async () => {
    await wakeNotYet();
    expect((await contextSnapshot())?.opening?.wake).toEqual({ kind: 'none' }); // asked less than 1 h ago
    await confirmWake(clock.now());
    expect((await getDayContext()).wakeSource).toBe('confirmed');
    await startDay();
    expect((await contextSnapshot())?.opening).toBeUndefined();
  });

  it('work timer survives closing the app and switches the day to WORK mode (quests held, not failed)', async () => {
    setNow('2026-09-23T08:12:00');
    await startWork();
    resetDbInstance(`lifeforge-context-${n}`); // "close and reopen the app": same database, fresh instance
    expect(await getOpenWork()).toMatchObject({ start: new Date('2026-09-23T08:12:00').getTime() });
    setNow('2026-09-23T14:55:00');
    const snap = (await contextSnapshot())!;
    expect(snap.view.state).toBe('WORK');
    expect(snap.view.focus).toEqual([]);
    expect(snap.view.workMinutes).toBe(403);
    const pending = (await questRepository.byDate('2026-09-23')).filter((q) => q.status === 'pending').length;
    expect(pending).toBeGreaterThan(0);
    setNow('2026-09-23T16:33:00');
    const r = await endWork();
    expect(r.minutes).toBe(501);
    expect(await getOpenWork()).toBeUndefined();
    const after = (await contextSnapshot())!;
    expect(after.view.state).toBe('POST_WORK');
    expect(after.view.focus.length).toBeGreaterThan(0);
    expect(after.view.focus.length).toBeLessThanOrEqual(4);
    expect((await questRepository.byDate('2026-09-23')).filter((q) => q.status === 'failed')).toHaveLength(0);
  });

  it('a session crossing midnight is stored once, on the day it started', async () => {
    setNow('2026-09-23T23:50:00');
    await startWork();
    setNow('2026-09-24T00:20:00');
    await endWork();
    expect((await getDayContext('2026-09-23')).work).toHaveLength(1);
    expect((await getDb().dayContexts.get('2026-09-24'))?.work.length ?? 0).toBe(0);
    expect((await workHistory()).rows[0].minutes).toBe(30);
  });

  it('forgotten timers are capped at 16 h', async () => {
    setNow('2026-09-23T08:00:00');
    await startWork();
    setNow('2026-09-24T09:00:00');
    const r = await endWork();
    expect(r).toMatchObject({ minutes: 960, capped: true });
  });

  it('adaptive schedule OFF → nothing learned; reset keeps all game data', async () => {
    for (const d of ['2026-09-14', '2026-09-15', '2026-09-16']) await getDb().dayContexts.put({ date: d, work: [], wakeUpTime: new Date(`${d}T07:40:00`).getTime(), wakeSource: 'confirmed', updatedAt: new Date(`${d}T07:40:00`).getTime() });
    expect((await learnedSchedule()).wake.all?.median).toBe(7 * 60 + 40);
    const s = (await settingsRepository.get())!;
    await settingsRepository.save({ ...s, routine: { ...s.routine, adaptive: false } });
    expect((await learnedSchedule()).wake.all).toBeUndefined();
    await settingsRepository.save({ ...s, routine: { ...s.routine, adaptive: true } });
    await suggestionRepository.offer({ id: 'sg1', key: 'time:x:19:00', type: 'scheduleTime', title: 'Move?', body: '', status: 'pending', createdAt: Date.now() } as never);
    const xp = (await playerRepository.get())!.xp;
    const quests = (await questRepository.byDate('2026-09-23')).length;
    await resetLearnedSchedule();
    expect((await learnedSchedule()).wake.all).toBeUndefined();
    expect(await getDb().dayContexts.count()).toBeGreaterThanOrEqual(3); // history kept
    expect((await playerRepository.get())!.xp).toBe(xp);
    expect((await questRepository.byDate('2026-09-23')).length).toBe(quests);
    expect((await suggestionRepository.pending()).some((x) => x.type === 'scheduleTime')).toBe(false);
  });
});
