import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activityRepository, getDb, metaRepository, questRepository, resetDbInstance, settingsRepository } from '@/repositories';
import { useAi } from '@/store/aiStore';
import { ensureSeeded } from '../../seedService';
import { beginAdventure } from '../../game/dayService';
import { clock } from '../../clock';
import { loadChat } from '../../coachService';
import { answerWithBasicCoach, applyAll, resolveAction, retryLast, sendMessage, undoAction } from '../orchestrator';

let n = 0;
async function fresh() {
  resetDbInstance(`lifeforge-orch-${++n}`);
  clock.setOffset(new Date('2026-09-23T09:00:00').getTime() - Date.now()); // Wednesday
  await ensureSeeded();
  await metaRepository.set('adventureStart', '2026-09-01');
  await beginAdventure();
  useAi.setState({ ui: 'connected', status: { state: 'connected', provider: 'gemini', model: 'gemini-test' }, checkedAt: Date.now() });
}

type Reply = { status?: number; body: unknown };
/** Test double for the app's own /api/ai endpoint (the real server is tested separately). */
function apiReplies(...replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    const r = replies.shift();
    if (!r) throw new Error('unexpected request');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, bodies };
}

const call = (name: string, args: Record<string, unknown>, id = `c_${name}`) => ({
  content: { role: 'model', parts: [{ functionCall: { id, name, args } }] },
  text: '',
  calls: [{ id, name, args }],
  model: 'gemini-test',
  usage: { inputTokens: 900, outputTokens: 20, totalTokens: 920 },
});
const say = (text: string) => ({ content: { role: 'model', parts: [{ text }] }, text, calls: [], model: 'gemini-test', usage: { inputTokens: 1000, outputTokens: 30, totalTokens: 1030 } });

describe('AI orchestrator', () => {
  beforeEach(fresh);
  afterEach(() => vi.unstubAllGlobals());

  it('read tools run automatically, then Gemini answers', async () => {
    const { bodies } = apiReplies({ body: call('getNutritionToday', {}) }, { body: say('You have 0 kcal logged so far today.') });
    const { state } = await sendMessage(await loadChat(), { text: 'Quante calorie ho mangiato?' });
    expect(state.messages.at(-1)!.text).toBe('You have 0 kcal logged so far today.');
    expect(state.messages.at(-1)!.ai).toBe(true);
    const second = bodies[1] as { contents: { role: string; parts: { functionResponse?: { name: string; response: { success: boolean } } }[] }[] };
    const fr = second.contents.at(-1)!.parts[0].functionResponse!;
    expect(fr.name).toBe('getNutritionToday');
    expect(fr.response.success).toBe(true);
    expect(String((bodies[0] as { context: string }).context)).toContain('2026-09-23');
    // usage is tracked locally (metadata only)
    const usage = await getDb().aiUsage.toArray();
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ type: 'chat', inputTokens: 900, ok: true, status: 200, image: false });
    expect(JSON.stringify(usage)).not.toContain('calorie');
  });

  it('write tools wait for confirmation; nothing changes until APPLY; the result goes back to Gemini', async () => {
    apiReplies({ body: call('scheduleOneTimeActivity', { title: 'Dentist', date: '2026-09-24', time: '17:00', durationMin: 45, category: 'personal_care' }) });
    const r1 = await sendMessage(await loadChat(), { text: 'Domani alle 17 dentista' });
    const msg = r1.state.messages.at(-1)!;
    expect(msg.actions?.[0]).toMatchObject({ status: 'pending', permission: 'write' });
    expect(r1.state.awaiting).toBeDefined();
    expect((await questRepository.byDate('2026-09-24')).some((q) => q.title === 'Dentist')).toBe(false);

    const { bodies } = apiReplies({ body: say('Added the dentist tomorrow at 17:00.') });
    const r2 = await resolveAction(r1.state, msg.id, msg.actions![0].id, 'apply');
    expect((await questRepository.byDate('2026-09-24')).some((q) => q.title === 'Dentist')).toBe(true);
    expect(r2.state.messages.at(-1)!.text).toBe('Added the dentist tomorrow at 17:00.');
    const fr = (bodies[0] as { contents: { parts: { functionResponse?: { response: { success: boolean } } }[] }[] }).contents.at(-1)!.parts[0].functionResponse!;
    expect(fr.response.success).toBe(true);

    const card = r2.state.messages.find((m) => m.id === msg.id)!.actions![0];
    expect(card.status).toBe('applied');
    const r3 = await undoAction(r2.state, msg.id, card.id);
    expect(r3.state.messages.find((m) => m.id === msg.id)!.actions![0].status).toBe('undone');
    expect((await questRepository.byDate('2026-09-24')).some((q) => q.title === 'Dentist')).toBe(false);
  });

  it('cancel sends a "cancelled" result so the model cannot claim success', async () => {
    apiReplies({ body: call('updateWaterGoal', { targetMl: 2500 }) });
    const r1 = await sendMessage(await loadChat(), { text: 'Water 2.5 L' });
    const msg = r1.state.messages.at(-1)!;
    const before = (await settingsRepository.get())!.hydration.targetMl;
    const { bodies } = apiReplies({ body: say('OK, I left your water target as it was.') });
    await resolveAction(r1.state, msg.id, msg.actions![0].id, 'cancel');
    expect((await settingsRepository.get())!.hydration.targetMl).toBe(before);
    const fr = (bodies[0] as { contents: { parts: { functionResponse?: { response: { success: boolean; cancelled: boolean } } }[] }[] }).contents.at(-1)!.parts[0].functionResponse!;
    expect(fr.response).toMatchObject({ success: false, cancelled: true });
  });

  it('multi-step: several write calls in one turn → APPLY ALL', async () => {
    const multi = {
      content: { role: 'model', parts: [{ functionCall: { name: 'updateWaterGoal', args: { targetMl: 2600 } } }, { functionCall: { name: 'createActivity', args: { name: 'Evening mobility', category: 'body', priority: 'optional', recurrence: { type: 'daily' }, durationMin: 10 } } }] },
      text: 'Two changes:',
      calls: [
        { name: 'updateWaterGoal', args: { targetMl: 2600 } },
        { name: 'createActivity', args: { name: 'Evening mobility', category: 'body', priority: 'optional', recurrence: { type: 'daily' }, durationMin: 10 } },
      ],
      model: 'gemini-test',
      usage: null,
    };
    apiReplies({ body: multi }, { body: say('Both done.') });
    const r1 = await sendMessage(await loadChat(), { text: 'Più acqua e stretching ogni giorno' });
    const msg = r1.state.messages.at(-1)!;
    expect(msg.actions).toHaveLength(2);
    const r2 = await applyAll(r1.state, msg.id);
    expect((await settingsRepository.get())!.hydration.targetMl).toBe(2600);
    expect((await activityRepository.all()).some((a) => a.name === 'Evening mobility')).toBe(true);
    expect(r2.state.messages.at(-1)!.text).toBe('Both done.');
  });

  it('invalid tool arguments are returned to the model as a failed result', async () => {
    const { bodies } = apiReplies({ body: call('updateWaterGoal', { targetMl: 99999 }) }, { body: say('That target is outside the safe range.') });
    await sendMessage(await loadChat(), { text: 'water 99 L' });
    const fr = (bodies[1] as { contents: { parts: { functionResponse?: { response: { success: boolean } } }[] }[] }).contents.at(-1)!.parts[0].functionResponse!;
    expect(fr.response.success).toBe(false);
  });

  it('quota error: GEMINI LIMIT REACHED + basic coach on request, never a crash', async () => {
    apiReplies({ status: 429, body: { error: { kind: 'quota', message: 'Gemini is temporarily unavailable because a usage limit has been reached.', quota: { limitType: 'rpd', quotaValue: 20, retryAfterSec: 120 } } } });
    const { state } = await sendMessage(await loadChat(), { text: 'Organizzami la giornata' });
    const last = state.messages.at(-1)!;
    expect(last.notice).toEqual({ kind: 'quota', text: 'GEMINI LIMIT REACHED' });
    expect(last.text).toMatch(/usage limit has been reached/);
    expect(useAi.getState().ui).toBe('quota');
    const usage = await getDb().aiUsage.toArray();
    expect(usage[0]).toMatchObject({ ok: false, status: 429, errorKind: 'quota', quota: { limitType: 'rpd', quotaValue: 20, retryAfterSec: 120 } });
    const basic = await answerWithBasicCoach(state);
    expect(basic.state.messages.at(-1)!.ai).toBeFalsy();
    expect(basic.state.messages.at(-1)!.role).toBe('coach');
  });

  it('server errors fall back to the basic coach with a notice', async () => {
    apiReplies({ status: 401, body: { error: { kind: 'invalid_key', message: 'Gemini connection failed. Check your API key.' } } });
    const { state } = await sendMessage(await loadChat(), { text: 'Da lunedì lavoro dalle 9 alle 18' });
    const last = state.messages.at(-1)!;
    expect(last.notice?.kind).toBe('invalid_key');
    expect(last.proposal?.status).toBe('pending'); // the on-device parser still did its job
  });

  it('without Gemini the basic coach proposes the same tool cards', async () => {
    useAi.setState({ ui: 'not_connected' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { state } = await sendMessage(await loadChat(), { text: 'Porta le proteine a 140 g' });
    expect(fetchMock).not.toHaveBeenCalled();
    const msg = state.messages.at(-1)!;
    expect(msg.actions?.[0]).toMatchObject({ name: 'updateNutritionTargets', status: 'pending' });
    await resolveAction(state, msg.id, msg.actions![0].id, 'apply');
    expect((await settingsRepository.get())!.nutrition.protein).toBe(140);
  });

  it('reset clarification → typed phrase required for everything', async () => {
    useAi.setState({ ui: 'not_connected' });
    let { state } = await sendMessage(await loadChat(), { text: 'Voglio ricominciare da zero' });
    expect(state.messages.at(-1)!.text).toBe('Do you want to reset your game progress only, or all historical data too?');
    ({ state } = await sendMessage(state, { text: 'All data too', value: 'tool:resetAllData' }));
    const msg = state.messages.at(-1)!;
    const card = msg.actions![0];
    expect(card.confirmPhrase).toBe('RESET EVERYTHING');
    const denied = await resolveAction(state, msg.id, card.id, 'apply', 'reset');
    expect(denied.state.messages.find((m) => m.id === msg.id)!.actions![0].status).toBe('pending');
    expect(await settingsRepository.get()).toBeDefined();
  });
});

describe('model router integration (client side)', () => {
  beforeEach(fresh);
  afterEach(() => vi.unstubAllGlobals());

  it('sends routing prefs (Free Tier only, request id, intent) and records one usage row per model attempt', async () => {
    const attempts = [
      { model: 'gemini-2.5-flash-lite', outcome: 'rate_limited', status: 429, latencyMs: 120, quota: { limitType: 'rpm', retryAfterSec: 30 }, cooldownUntil: Date.now() + 30_000 },
      { model: 'gemini-2.5-flash', outcome: 'ok', latencyMs: 900 },
    ];
    const { bodies } = apiReplies({ body: { ...say('Ciao!'), model: 'gemini-2.5-flash', routing: { requestType: 'TEXT_CHAT', model: 'gemini-2.5-flash', reason: 'gemini-2.5-flash-lite failed (rate limited); switched to fallback gemini-2.5-flash', fallback: true, attempts, freeTierOnly: true } } });
    const { state } = await sendMessage(await loadChat(), { text: 'Che cosa devo fare oggi?' });
    const routing = (bodies[0] as { routing: { freeTierOnly: boolean; requestId: string; intent: string } }).routing;
    expect(routing).toMatchObject({ freeTierOnly: true, intent: 'TEXT_CHAT' });
    expect(routing.requestId).toMatch(/^r_/);
    // Non-invasive note, no error, conversation continues.
    expect(state.messages.at(-1)).toMatchObject({ text: 'Ciao!', notice: { kind: 'switched', text: 'AI model switched automatically.' } });
    const rows = await getDb().aiUsage.toArray();
    expect(rows.map((r) => [r.model, r.ok, r.status])).toEqual([
      ['gemini-2.5-flash-lite', false, 429],
      ['gemini-2.5-flash', true, 200],
    ]);
    expect(rows[1]).toMatchObject({ inputTokens: 1000, fallback: true });
    // The next request tells the server that the first model is cooling down.
    const next = apiReplies({ body: say('Ok') });
    await sendMessage(state, { text: 'E domani?' });
    const hints = (next.bodies[0] as { routing: { hints: Record<string, { cooldownUntil?: number; status?: string }> } }).routing.hints;
    expect(hints['gemini-2.5-flash-lite']).toMatchObject({ status: 'RATE_LIMITED' });
    expect(hints['gemini-2.5-flash-lite'].cooldownUntil).toBeGreaterThan(Date.now());
  });

  it('keeps the same model for the rest of a turn (lastModel) when resuming after confirmation', async () => {
    apiReplies({ body: { ...call('updateWaterGoal', { targetMl: 2400 }), model: 'gemini-2.5-flash' } });
    const r1 = await sendMessage(await loadChat(), { text: 'Acqua 2,4 litri' });
    const msg = r1.state.messages.at(-1)!;
    const { bodies } = apiReplies({ body: say('Fatto.') });
    await resolveAction(r1.state, msg.id, msg.actions![0].id, 'apply');
    expect((bodies[0] as { routing: { lastModel: string } }).routing.lastModel).toBe('gemini-2.5-flash');
  });

  it('no compatible model → "temporarily unavailable" card with TRY AGAIN, never a crash', async () => {
    apiReplies({ status: 503, body: { error: { kind: 'no_model', message: 'Gemini is temporarily unavailable for this type of request.', routing: { attempts: [], retryAt: Date.now() + 120_000 } } } });
    const { state } = await sendMessage(await loadChat(), { text: 'Organizzami la settimana' });
    expect(state.messages.at(-1)).toMatchObject({ notice: { kind: 'no_model', text: 'GEMINI UNAVAILABLE' } });
    expect(state.messages.at(-1)!.text).toMatch(/temporarily unavailable for this type of request.*about 2 min/);
    apiReplies({ status: 403, body: { error: { kind: 'cost_blocked', message: 'This model cannot be verified as Free Tier.' } } });
    const r2 = await retryLast(state);
    expect(r2.state.messages.at(-1)).toMatchObject({ text: 'This model cannot be verified as Free Tier.', notice: { kind: 'no_model', text: 'NO VERIFIED FREE TIER MODEL' } });
  });

  it('simple commands are handled on the device without calling Gemini', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const water = (await questRepository.byDate('2026-09-23')).find((q) => /water/i.test(q.title) && q.status === 'pending');
    expect(water).toBeDefined();
    const { state } = await sendMessage(await loadChat(), { text: 'Segna acqua completata' });
    expect(fetchMock).not.toHaveBeenCalled();
    const msg = state.messages.at(-1)!;
    expect(msg.local).toBe(true);
    expect(msg.actions?.[0]).toMatchObject({ name: 'completeQuest', status: 'applied' });
    expect((await questRepository.get(water!.id))!.status).toBe('completed');
    const t = await sendMessage(state, { text: 'Porta le calorie a 1900' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(t.state.messages.at(-1)!.actions?.[0]).toMatchObject({ name: 'updateNutritionTargets', status: 'pending' });
  });

  it('idempotency: the same tool call is never executed twice', async () => {
    const { prepare, execute } = await import('../tools/registry');
    const p = await prepare({ name: 'scheduleOneTimeActivity', args: { title: 'Dentist', date: '2026-09-25', durationMin: 30, category: 'personal_care' } });
    if (!p.ok || p.kind !== 'action') throw new Error('prepare failed');
    const a = await execute(p.action, { source: 'gemini', idempotencyKey: 'r_1:0:c1' });
    const b = await execute(p.action, { source: 'gemini', idempotencyKey: 'r_1:0:c1' });
    expect(a.result.success).toBe(true);
    expect(b.result).toMatchObject({ success: true, duplicate: true });
    expect((await questRepository.byDate('2026-09-25')).filter((q) => q.title === 'Dentist')).toHaveLength(1);
  });

  it('a replayed Gemini step (same calls) does not auto-complete a quest twice', async () => {
    const q = (await questRepository.byDate('2026-09-23')).find((x) => x.status === 'pending' && !x.target)!;
    const step = { ...call('completeQuest', { questId: q.id }, 'dup'), model: 'gemini-2.5-flash' };
    apiReplies({ body: step }, { body: say('Fatto.') });
    const r1 = await sendMessage(await loadChat(), { text: 'Ho finito la quest' });
    expect(r1.state.messages.some((m) => m.actions?.some((c) => c.status === 'applied'))).toBe(true);
    const xp = (await getDb().player.get('me'))!.xp;
    // Undo + replay of the same request must not create a second completion reward loop.
    const { execute, prepare } = await import('../tools/registry');
    const p = await prepare({ name: 'completeQuest', args: { questId: q.id } });
    expect(p.ok).toBe(false); // already completed → refused, nothing runs
    if (p.ok && p.kind === 'action') await execute(p.action, { source: 'gemini' });
    expect((await getDb().player.get('me'))!.xp).toBe(xp);
  });
});
