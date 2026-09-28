import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metaRepository, resetDbInstance, settingsRepository, statsRepository } from '@/repositories';
import { ensureSeeded } from '../seedService';
import { beginAdventure } from '../game/dayService';
import { planFor } from '../game/dayPlan';
import { applyProposal, type ChatState, dismissProposal, loadChat, sendMessage } from '../coachService';
import { clock } from '../clock';

let n = 0;
async function fresh() {
  resetDbInstance(`lifeforge-coach-${++n}`);
  clock.setOffset(new Date('2026-09-23T09:00:00').getTime() - Date.now()); // Wednesday
  await ensureSeeded();
  await metaRepository.set('adventureStart', '2026-09-01');
  await beginAdventure();
}

const lastCoach = (s: ChatState) => [...s.messages].reverse().find((m) => m.role === 'coach')!;

describe('coach service (IndexedDB)', () => {
  beforeEach(fresh);
  afterEach(() => vi.unstubAllGlobals());

  it('previews a recurring schedule with its impact, then applies it on confirm', async () => {
    let { state } = await sendMessage(await loadChat(), { text: 'Da lunedì lavoro dalle 9 alle 18.' });
    const msg = lastCoach(state);
    expect(msg.proposal?.status).toBe('pending');
    expect(msg.proposal?.impact).toContain('This will affect your daily workload.');
    expect(msg.proposal?.impact?.join(' ')).toMatch(/Takes effect Mon 28 Sep/);
    expect((await settingsRepository.get())!.work.status).toBe('not_set'); // nothing changed yet
    ({ state } = await applyProposal(state, msg.proposal!.id));
    const s = (await settingsRepository.get())!;
    expect(s.work.status).toBe('set');
    expect((await planFor('2026-09-28', s)).work).toEqual({ start: '09:00', end: '18:00', label: 'Work' });
    expect((await planFor('2026-09-24', s)).workStatus).toBe('unknown');
    expect(lastCoach(state).text).toMatch(/^Done ✓/);
  });

  it('"sì" confirms the pending proposal; a temporary day leaves the regular week alone', async () => {
    const { state } = await sendMessage(await loadChat(), { text: 'Oggi lavoro dalle 10 alle 20' });
    expect(lastCoach(state).proposal?.impact?.join(' ')).toMatch(/Today: load/);
    const confirmed = await sendMessage(state, { text: 'sì' });
    expect(lastCoach(confirmed.state).text).toMatch(/^Done ✓/);
    const s = (await settingsRepository.get())!;
    expect(s.work.status).toBe('not_set');
    expect((await planFor('2026-09-23', s))).toMatchObject({ temporary: true, work: { start: '10:00', end: '20:00' } });
    const log = await statsRepository.getLog('2026-09-23');
    expect(log?.workStatus).toBe('set');
  });

  it('dismissing changes nothing', async () => {
    let { state } = await sendMessage(await loadChat(), { text: 'Questa settimana non posso andare in palestra.' });
    state = await dismissProposal(state, lastCoach(state).proposal!.id);
    expect((await settingsRepository.get())!.exceptions).toHaveLength(0);
    expect(lastCoach(state).text).toBe('OK — nothing changes.');
  });

  it('plan my day with unknown hours → NOT YET → provisional plan listing quests', async () => {
    let { state } = await sendMessage(await loadChat(), { text: 'Organizzami la giornata' });
    expect(lastCoach(state).quick?.map((q) => q.label)).toEqual(['YES', 'NOT YET']);
    ({ state } = await sendMessage(state, { text: 'NOT YET', value: 'plan:no' }));
    expect(lastCoach(state).info?.length).toBeGreaterThan(0);
    expect(lastCoach(state).text).toMatch(/provisional plan/);
  });

});

describe('on-device coach commands and memory', () => {
  beforeEach(fresh);

  it('answers "what should I do right now?" and "plan my evening" from the real board, without AI', async () => {
    const { ensureToday } = await import('../game/dayService');
    await ensureToday();
    let { state } = await sendMessage(await loadChat(), { text: 'What should I do right now?' });
    let msg = lastCoach(state);
    expect(msg.local).toBe(true);
    expect(msg.text).toMatch(/^Do this now: |Nothing is pending|wind-down/);
    ({ state } = await sendMessage(state, { text: 'How much time do I actually have today?' }));
    msg = lastCoach(state);
    expect(msg.info?.map((i) => i.label)).toContain('Realistically free');
    ({ state } = await sendMessage(state, { text: 'Show me what I have postponed' }));
    expect(lastCoach(state).text).toMatch(/Nothing postponed|postponed/);
    ({ state } = await sendMessage(state, { text: 'Help me recover from a bad day' }));
    expect(lastCoach(state).text).toMatch(/Bad days happen/);
    expect(lastCoach(state).quick?.[0].label).toBe('Make today lighter');
    ({ state } = await sendMessage(state, { text: 'Prepare tomorrow' }));
    expect(lastCoach(state).info?.[0].label).toMatch(/Thursday/);
  });

  it('memory: remember, recall, forget — and the notes reach the AI context', async () => {
    const { listMemory } = await import('../coachMemoryService');
    const { buildContext } = await import('../ai/context');
    let { state } = await sendMessage(await loadChat(), { text: 'Remember that I hate running' });
    expect(lastCoach(state).text).toMatch(/Saved to my memory/);
    ({ state } = await sendMessage(state, { text: 'Remember that I hate running' }));
    expect(lastCoach(state).text).toMatch(/already remember/);
    expect((await listMemory()).map((n) => n.text)).toEqual(['I hate running']);
    expect(JSON.parse(await buildContext()).playerNotes).toEqual(['I hate running']);
    ({ state } = await sendMessage(state, { text: 'What do you remember?' }));
    expect(lastCoach(state).info?.[0].label).toBe('I hate running');
    ({ state } = await sendMessage(state, { text: 'Forget the running note' }));
    expect(lastCoach(state).text).toMatch(/Forgotten/);
    expect(await listMemory()).toEqual([]);
    expect(JSON.parse(await buildContext()).playerNotes).toBeUndefined();
  });

  it('private quests are masked in the AI context', async () => {
    const { ensureToday } = await import('../game/dayService');
    const { questRepository } = await import('@/repositories');
    await ensureToday();
    const q = (await questRepository.byDate(clock.today())).find((x) => x.status === 'pending')!;
    await questRepository.put({ ...q, private: true, title: 'Secret thing' });
    const { buildContext } = await import('../ai/context');
    const ctx = await buildContext();
    expect(ctx).not.toContain('Secret thing');
  });
});
