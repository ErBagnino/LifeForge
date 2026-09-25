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

  it('falls back to the optional AI model only when configured, and validates its output', async () => {
    const s = (await settingsRepository.get())!;
    await settingsRepository.save({ ...s, coach: { ...s.coach, ai: { enabled: true, model: 'test-model' } } });
    const store = new Map<string, string>([['lf-ai-key', 'sk-test']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'coach_reply', input: { reply: 'Got it: gym-free weekend.', changes: [{ type: 'exception', kind: 'no_gym', from: '2026-09-26', to: '2026-09-27' }] } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { state } = await sendMessage(await loadChat(), { text: 'Il weekend sono in montagna senza attrezzi' });
    const msg = lastCoach(state);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'test-model', tool_choice: { type: 'tool', name: 'coach_reply' } });
    expect(msg.ai).toBe(true);
    expect(msg.proposal?.changes).toEqual([{ type: 'exception', kind: 'no_gym', from: '2026-09-26', to: '2026-09-27' }]);

    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'coach_reply', input: { reply: 'x', changes: [{ type: 'work_schedule', days: [] }] } }] }), { status: 200 }));
    const bad = await sendMessage(state, { text: 'qualcosa di strano' });
    expect(lastCoach(bad.state).proposal).toBeUndefined();
  });
});
