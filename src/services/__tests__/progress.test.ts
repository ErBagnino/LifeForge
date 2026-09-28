import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, metaRepository, questRepository, resetDbInstance } from '@/repositories';
import { clock } from '../clock';
import { ensureSeeded } from '../seedService';
import { beginAdventure, ensureToday } from '../game/dayService';
import { completeQuest } from '../game/questService';
import { runReset } from '../resetService';
import { equipTitle, getEquippedTitle, getShowcase, loadJourney, loadMastery, loadMomentum, toggleShowcase } from '../progressService';

let n = 0;
beforeEach(async () => {
  resetDbInstance(`lifeforge-progress-${++n}`);
  clock.setOffset(new Date('2026-03-02T09:00:00').getTime() - Date.now());
  await ensureSeeded();
  await metaRepository.set('adventureStart', clock.today());
  await beginAdventure();
  await ensureToday();
});

describe('progress service', () => {
  it('mastery and momentum come from real completions; titles need the level', async () => {
    const empty = await loadMastery();
    expect(empty.every((t) => t.points === 0)).toBe(true);
    const pending = (await questRepository.byDate(clock.today())).filter((q) => q.status === 'pending' && !q.metric && !q.goal && q.kind !== 'workout');
    expect(pending.length).toBeGreaterThan(1);
    await completeQuest(pending[0].id);
    await completeQuest(pending[1].id);
    const m = await loadMastery();
    expect(m.reduce((s, t) => s + t.completions, 0)).toBeGreaterThanOrEqual(1);
    expect((await loadMomentum()).combo).toBe(2);
    const r = await equipTitle('mind:5');
    expect(r.ok).toBe(false);
    expect(await getEquippedTitle()).toBeUndefined();
  });

  it('showcase: only unlocked achievements, at most three; game reset clears progression choices', async () => {
    const all = await getDb().achievements.toArray();
    expect(await toggleShowcase(all[0].id)).toEqual([]); // locked
    for (const a of all.slice(0, 4)) await getDb().achievements.update(a.id, { unlockedAt: clock.now() });
    for (const a of all.slice(0, 4)) await toggleShowcase(a.id);
    expect(await getShowcase()).toEqual(all.slice(1, 4).map((a) => a.id));
    await toggleShowcase(all[2].id);
    expect(await getShowcase()).toEqual([all[1].id, all[3].id]);
    await metaRepository.set('equippedTitle', 'mind:5');
    await runReset('game');
    expect(await getShowcase()).toEqual([]);
    expect(await getEquippedTitle()).toBeUndefined();
    expect(await metaRepository.get('progressSince')).toBe(clock.today());
  });

  it('journey starts with the adventure and has a current chapter', async () => {
    const j = (await loadJourney())!;
    expect(j.adventureDay).toBe(1);
    expect(j.chapters).toHaveLength(1);
    expect(j.chapters[0]).toMatchObject({ n: 1, status: 'current' });
    expect(j.milestones.map((m) => m.kind)).toContain('start');
  });
});
