import { classifyCoachText } from '@/ai/shared/classify';
import { isLocalCommand } from '@/domain/ruleIntents';
import { questRepository, settingsRepository } from '@/repositories';
import type { CoachPersonality } from '@/types';
import { geminiReady, useAi } from '@/store/aiStore';
import { uid } from '@/utils/id';
import { type ActionCard, type AwaitingTurn, type ChatMessage, type ChatState, save, sendMessage as basicCoach } from '../coachService';
import type { GameEvent, ServiceResult } from '../events';
import { clock } from '../clock';
import { undoChange } from './changeLog';
import { buildContext } from './context';
import { AiClientError, CLIENT_ERROR_MESSAGES, type ChatResponse, type GeminiContent, geminiProvider } from './gemini';
import { cancelledResult, execute, permissionOf, prepare, runRead, type ToolResult } from './tools/registry';

/**
 * AIOrchestrator: runs one Coach turn.
 *
 *   user → Gemini → function calls → validate → (read: run | low: run + undo |
 *   write/destructive: preview card, wait for the user) → game engine → results →
 *   Gemini → final reply.
 *
 * The server is stateless; this module keeps the turn's contents. Only a short
 * text transcript is kept between turns (quota), and photos are never persisted.
 * Without Gemini (not connected, disabled, offline, quota) the basic coach answers.
 */

const MAX_STEPS = 6;
const HISTORY_TURNS = 10;

export interface TurnInput {
  text: string;
  value?: string;
  image?: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };
}

export interface TurnResult {
  state: ChatState;
  result?: ServiceResult;
  /** All data was deleted: the app must restart. */
  reload?: boolean;
}

let controller: AbortController | undefined;

/** Cancel the request in flight (Stop button / leaving the screen). */
export function cancelTurn(): void {
  controller?.abort();
  controller = undefined;
}

const coachMsg = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: uid('m_'), role: 'coach', text, ts: Date.now(), ...extra });

function stripImages(contents: GeminiContent[]): GeminiContent[] {
  return contents.map((c) => ({ ...c, parts: c.parts.map((p) => ('inlineData' in p ? { text: '[photo not kept]' } : p)) }));
}

function history(state: ChatState): GeminiContent[] {
  const turns = (state.transcript ?? []).filter((t) => t.text.trim()).slice(-HISTORY_TURNS * 2);
  // Gemini expects the conversation to start with a user turn.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

function remember(state: ChatState, user: string, model: string): ChatState['transcript'] {
  const add = [...(user.trim() ? [{ role: 'user' as const, text: user.slice(0, 600) }] : []), { role: 'model' as const, text: model.slice(0, 800) }];
  return [...(state.transcript ?? []), ...add].slice(-HISTORY_TURNS * 2);
}

const toResponse = (r: ToolResult): Record<string, unknown> => ({ success: r.success, message: r.message, ...(r.data !== undefined ? { data: r.data } : {}), ...(r.cancelled ? { cancelled: true } : {}), ...(r.changeId ? { undoable: true } : {}) });

function responseParts(calls: AwaitingTurn['calls']): Record<string, unknown>[] {
  return calls.map((c) => ({ functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.name, response: c.result ?? toResponse(cancelledResult()) } }));
}

/** Summary written by the app itself when Gemini can't write one (never claims more than the results). */
function localSummary(cards: ActionCard[]): string {
  const applied = cards.filter((c) => c.status === 'applied');
  const other = cards.filter((c) => c.status !== 'applied');
  const parts = [];
  if (applied.length) parts.push(`Applied: ${applied.map((c) => c.title).join('; ')}.`);
  if (other.length) parts.push(`Not applied: ${other.map((c) => c.title).join('; ')}.`);
  return parts.join(' ') || 'Nothing changed.';
}

// ——— Entry point ———

export async function sendMessage(state: ChatState, input: TurnInput, opts: { forceBasic?: boolean } = {}): Promise<TurnResult> {
  const settings = await settingsRepository.get();
  if (!settings) throw new Error('Game not initialised');
  // Quick replies from the basic coach (plan:…, tool:…) stay with the basic coach.
  const basicValue = input.value && !input.value.startsWith('text:');
  if (opts.forceBasic || basicValue || !geminiReady(settings.coach.ai.enabled)) {
    if (input.image) {
      const msg = coachMsg('Photos need Gemini, which isn’t connected right now. You can still log meals manually in Nutrition.', { notice: { kind: 'basic', text: 'Basic coach' } });
      return { state: await save({ ...state, messages: [...state.messages, { id: uid('m_'), role: 'user', text: input.text || '📷 Photo', ts: Date.now(), photo: true }, msg] }) };
    }
    return basicCoach(state, input);
  }
  // Commands the device handles with certainty never spend a Gemini request.
  if (!input.image && (await localCommand(input.text))) {
    const r = await basicCoach(state, input);
    const msgs = r.state.messages;
    const last = msgs[msgs.length - 1];
    return { ...r, state: await save({ ...r.state, messages: [...msgs.slice(0, -1), { ...last, local: true }] }) };
  }
  return geminiTurn(state, input, settings.coach.personality);
}

async function localCommand(text: string): Promise<boolean> {
  const today = clock.today();
  const pending = (await questRepository.byDate(today)).filter((q) => q.status === 'pending').map((q) => ({ id: q.id, title: q.title }));
  return isLocalCommand(text, today, pending);
}

async function geminiTurn(state: ChatState, input: TurnInput, personality: CoachPersonality): Promise<TurnResult> {
  const user: ChatMessage = { id: uid('m_'), role: 'user', text: input.text || '📷 Photo', ts: Date.now(), photo: !!input.image };
  const parts: Record<string, unknown>[] = [];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.data } });
  parts.push({ text: input.text || 'What do you see? Help me log or plan it.' });
  const contents: GeminiContent[] = [...history(state), { role: 'user', parts }];
  // A new message abandons any turn still waiting for confirmations.
  const base: ChatState = { ...state, awaiting: undefined, messages: [...cancelPending(state.messages), user] };
  return loop(base, contents, { userText: input.text, personality, step: 0, cards: [], events: [] });
}

function cancelPending(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.actions?.some((a) => a.status === 'pending') ? { ...m, actions: m.actions.map((a) => (a.status === 'pending' ? { ...a, status: 'cancelled' as const, result: 'Not applied (conversation moved on).' } : a)) } : m));
}

interface LoopCtx {
  userText: string;
  /** Model that answered the previous step (kept by the router when healthy). */
  model?: string;
  /** A fallback model answered at some point in this turn. */
  switched?: boolean;
  personality: CoachPersonality;
  step: number;
  /** Cards already shown in this turn (for the local summary). */
  cards: ActionCard[];
  events: GameEvent[];
  messageId?: string;
}

async function loop(state: ChatState, contents: GeminiContent[], ctx: LoopCtx): Promise<TurnResult> {
  controller = new AbortController();
  const signal = controller.signal;
  let res: ChatResponse;
  let stepId: string;
  for (;;) {
    stepId = uid('r_');
    try {
      res = await geminiProvider.chat(
        { contents, context: await buildContext(), personality: ctx.personality },
        { signal, requestId: stepId, lastModel: ctx.model, intent: ctx.step === 0 && ctx.userText ? classifyCoachText(ctx.userText) : undefined },
      );
    } catch (e) {
      return failTurn(state, ctx, e);
    }
    contents.push(res.content);
    ctx.model = res.model;
    if (res.routing?.fallback) ctx.switched = true;
    if (!res.calls.length) break;
    if (ctx.step >= MAX_STEPS) {
      res = { ...res, text: res.text || localSummary(ctx.cards) };
      break;
    }
    ctx.step += 1;

    const calls: AwaitingTurn['calls'] = res.calls.map((c) => ({ id: c.id, name: c.name, args: c.args }));
    const cards: ActionCard[] = [];
    for (const [i, call] of calls.entries()) {
      const permission = permissionOf(call.name);
      if (permission === 'read' || !permission) {
        call.result = toResponse(await runRead(call));
        continue;
      }
      const p = await prepare(call);
      if (!p.ok) {
        call.result = toResponse(p.result);
        continue;
      }
      if (p.kind !== 'action') continue;
      const a = p.action;
      const card: ActionCard = { id: uid('a_'), callIndex: i, name: a.call.name, args: a.call.args, permission: a.permission, title: a.title, lines: a.lines, warnings: a.warnings, confirmPhrase: a.confirmPhrase, undoable: a.undoable, status: 'pending' };
      if (a.permission === 'low') {
        // Low-risk (complete/skip): applied right away, with an Undo button.
        const { result, events } = await execute(a, { source: 'gemini', idempotencyKey: `${stepId}:${i}:${call.id ?? call.name}` });
        ctx.events.push(...events);
        call.result = toResponse(result);
        Object.assign(card, { status: result.success ? 'applied' : 'failed', result: result.message, changeId: result.changeId });
      }
      cards.push(card);
    }
    ctx.cards.push(...cards);

    if (cards.some((c) => c.status === 'pending')) {
      // Pause: show the preview cards and wait for the user.
      const msg = coachMsg(res.text || (cards.length > 1 ? 'Here’s what I’d change. Check it and apply:' : 'Here’s the change. Check it and apply:'), { ai: true, actions: cards });
      const awaiting: AwaitingTurn = { messageId: msg.id, contents: stripImages(contents), calls, step: ctx.step, stepId, model: ctx.model };
      const next = await save({ ...state, messages: [...state.messages, msg], awaiting, transcript: remember(state, ctx.userText, `${msg.text} [proposed: ${cards.map((c) => c.title).join('; ')}]`) });
      return { state: next, result: { events: ctx.events } };
    }
    if (cards.length) state = { ...state, messages: [...state.messages, coachMsg(res.text || 'Done:', { ai: true, actions: cards })] };
    contents.push({ role: 'user', parts: responseParts(calls) });
  }
  const text = res.text.trim() || localSummary(ctx.cards);
  const msg = coachMsg(text, { ai: true, ...(ctx.switched ? { notice: { kind: 'switched', text: 'AI model switched automatically.' } } : {}) });
  const next = await save({ ...state, messages: [...state.messages, msg], awaiting: undefined, transcript: remember(state, ctx.userText, text) });
  return { state: next, result: { events: ctx.events } };
}

async function failTurn(state: ChatState, ctx: LoopCtx, e: unknown): Promise<TurnResult> {
  const err = e instanceof AiClientError ? e : new AiClientError('server', (e as Error)?.message);
  if (err.kind === 'aborted') {
    return { state: await save({ ...state, awaiting: undefined, messages: [...state.messages, coachMsg('Stopped.')] }), result: { events: ctx.events } };
  }
  useAi.getState().noteError(err.kind);
  const done = ctx.cards.some((c) => c.status === 'applied') ? ` ${localSummary(ctx.cards)}` : '';
  if (err.kind === 'no_model' || err.kind === 'cost_blocked') {
    const when = err.retryAt && err.retryAt > Date.now() ? ` A model should be available again in about ${Math.max(1, Math.ceil((err.retryAt - Date.now()) / 60_000))} min.` : '';
    const msg = coachMsg(`${err.message}${when}${done}`, { notice: { kind: 'no_model', text: err.kind === 'cost_blocked' ? 'NO VERIFIED FREE TIER MODEL' : 'GEMINI UNAVAILABLE' } });
    return { state: await save({ ...state, awaiting: undefined, messages: [...state.messages, msg] }), result: { events: ctx.events } };
  }
  if (err.kind === 'quota') {
    const retry = err.quota?.retryAfterSec ? ` Google says you can retry in about ${Math.ceil(err.quota.retryAfterSec / 60)} min.` : '';
    const msg = coachMsg(`${CLIENT_ERROR_MESSAGES.quota}${retry}${done}`, { notice: { kind: 'quota', text: 'GEMINI LIMIT REACHED' } });
    return { state: await save({ ...state, awaiting: undefined, messages: [...state.messages, msg] }), result: { events: ctx.events } };
  }
  // Any other problem: say what happened, and let the basic coach answer the same text.
  const notice = { kind: err.kind, text: err.message };
  if (done || !ctx.userText) {
    return { state: await save({ ...state, awaiting: undefined, messages: [...state.messages, coachMsg(`${err.message}${done}`, { notice })] }), result: { events: ctx.events } };
  }
  const withoutUser = { ...state, awaiting: undefined, messages: state.messages.slice(0, -1) };
  const r = await basicCoach(withoutUser, { text: ctx.userText });
  const msgs = r.state.messages;
  const last = msgs[msgs.length - 1];
  const patched = { ...r.state, messages: [...msgs.slice(0, -1), { ...last, notice }] };
  return { state: await save(patched), result: { events: [...ctx.events, ...(r.result?.events ?? [])] } };
}

// ——— Confirmations ———

function findCard(state: ChatState, messageId: string, cardId: string): { msg: ChatMessage; card: ActionCard } | undefined {
  const msg = state.messages.find((m) => m.id === messageId);
  const card = msg?.actions?.find((a) => a.id === cardId);
  return msg && card ? { msg, card } : undefined;
}

function patchCard(state: ChatState, messageId: string, cardId: string, patch: Partial<ActionCard>): ChatState {
  return { ...state, messages: state.messages.map((m) => (m.id === messageId ? { ...m, actions: m.actions?.map((a) => (a.id === cardId ? { ...a, ...patch } : a)) } : m)) };
}

/** Apply or cancel one action card. When a paused Gemini turn has no pending cards left, it resumes. */
export async function resolveAction(state: ChatState, messageId: string, cardId: string, decision: 'apply' | 'cancel', typedPhrase?: string): Promise<TurnResult> {
  const found = findCard(state, messageId, cardId);
  if (!found || found.card.status !== 'pending') return { state };
  const events: GameEvent[] = [];
  let result: ToolResult;
  if (decision === 'cancel') {
    result = cancelledResult();
    state = patchCard(state, messageId, cardId, { status: 'cancelled', result: 'Cancelled — nothing changed.' });
  } else {
    const p = await prepare({ name: found.card.name, args: found.card.args });
    if (!p.ok || p.kind !== 'action') {
      result = p.ok ? { success: false, message: 'Not an action.' } : p.result;
    } else {
      const aw0 = state.awaiting?.messageId === messageId ? state.awaiting : undefined;
      const r = await execute(p.action, { source: aw0 ? 'gemini' : 'rules', typedPhrase, idempotencyKey: aw0 ? `${aw0.stepId ?? messageId}:${found.card.callIndex}:${found.card.name}` : `card:${found.card.id}` });
      events.push(...r.events);
      result = r.result;
      if (!result.success && result.error === 'confirmation_required') return { state: await save(patchCard(state, messageId, cardId, { result: result.message })) };
    }
    state = patchCard(state, messageId, cardId, { status: result.success ? 'applied' : 'failed', result: result.message, changeId: result.changeId, undoable: !!result.changeId });
    if (result.success && found.card.name === 'resetAllData') {
      // Everything is gone (including this chat): the app restarts from onboarding.
      return { state: { messages: [] }, result: { events: [] }, reload: true };
    }
  }

  const aw = state.awaiting;
  if (aw && aw.messageId === messageId && found.card.callIndex !== undefined) {
    aw.calls[found.card.callIndex].result = toResponse(result);
    const msg = state.messages.find((m) => m.id === messageId)!;
    if (!msg.actions?.some((a) => a.status === 'pending')) {
      // All confirmations done → send the results back to Gemini for the final reply.
      const contents = [...aw.contents, { role: 'user' as const, parts: responseParts(aw.calls) }];
      const settings = await settingsRepository.get();
      const base = { ...state, awaiting: undefined };
      if (!settings || !geminiReady(settings.coach.ai.enabled)) {
        const next = await save({ ...base, messages: [...base.messages, coachMsg(localSummary(msg.actions ?? []))] });
        return { state: next, result: { events } };
      }
      const r = await loop(base, contents, { userText: '', personality: settings.coach.personality, step: aw.step, cards: msg.actions ?? [], events, model: aw.model });
      return r;
    }
  }
  return { state: await save(state), result: { events } };
}

/** APPLY ALL: apply every pending (non-destructive) card of a message in order. */
export async function applyAll(state: ChatState, messageId: string): Promise<TurnResult> {
  const msg = state.messages.find((m) => m.id === messageId);
  const ids = (msg?.actions ?? []).filter((a) => a.status === 'pending' && !a.confirmPhrase && a.permission !== 'destructive').map((a) => a.id);
  const events: GameEvent[] = [];
  let current: TurnResult = { state };
  for (const id of ids) {
    current = await resolveAction(current.state, messageId, id, 'apply');
    events.push(...(current.result?.events ?? []));
  }
  return { state: current.state, result: { events } };
}

export async function undoAction(state: ChatState, messageId: string, cardId: string): Promise<TurnResult> {
  const found = findCard(state, messageId, cardId);
  if (!found?.card.changeId || found.card.status !== 'applied') return { state };
  const r = await undoChange(found.card.changeId);
  const next = patchCard(state, messageId, cardId, r.success ? { status: 'undone', result: r.message, undoable: false } : { result: r.message });
  return { state: await save(next), result: { events: r.events } };
}

/** [USE BASIC COACH] after a quota error: answer the last user message with the on-device coach. */
export async function answerWithBasicCoach(state: ChatState): Promise<TurnResult> {
  const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return { state };
  const idx = state.messages.lastIndexOf(lastUser);
  return basicCoach({ ...state, messages: state.messages.slice(0, idx) }, { text: lastUser.text });
}

/** [TRY AGAIN] after "Gemini is temporarily unavailable": resend the last user message. */
export async function retryLast(state: ChatState): Promise<TurnResult> {
  const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return { state };
  const idx = state.messages.lastIndexOf(lastUser);
  return sendMessage({ ...state, messages: state.messages.slice(0, idx) }, { text: lastUser.text });
}

/** Settings → AI → Clear AI history: forget the Gemini transcript (chat bubbles stay). */
export async function clearAiHistory(state: ChatState): Promise<ChatState> {
  return save({ ...state, transcript: [], awaiting: undefined });
}
