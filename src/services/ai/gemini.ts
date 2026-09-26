import type { FoodEstimate, FoodRequest } from '@/ai/shared/food';
import type { ModelsResponse, RoutingAttempt, RoutingInfo, RoutingPrefs } from '@/ai/shared/models';
import type { ChatRequest } from '@/ai/shared/tools';
import { settingsRepository } from '@/repositories';
import type { AiRequestType, AiUsageRecord } from '@/types';
import { uid } from '@/utils/id';
import { currentHints, noteRouting } from './routerState';
import { recordUsage, recordUsageMany } from './usageService';

/**
 * Client side of the Gemini integration. The app only talks to its own serverless
 * API (/api/*); the Gemini API key exists only on the server (Vercel env var).
 */

export type AiErrorKind = 'not_configured' | 'invalid_key' | 'quota' | 'model' | 'image' | 'bad_request' | 'server' | 'offline' | 'aborted' | 'no_model' | 'cost_blocked';

export interface QuotaInfo {
  limitType?: 'rpm' | 'tpm' | 'rpd' | 'tpd' | 'other';
  quotaValue?: number;
  retryAfterSec?: number;
}

export const CLIENT_ERROR_MESSAGES: Record<AiErrorKind, string> = {
  not_configured: 'Gemini is not connected yet. Add GEMINI_API_KEY in Vercel and redeploy.',
  invalid_key: 'Gemini connection failed. Check your API key.',
  quota: 'Gemini is temporarily unavailable because a usage limit has been reached.',
  model: 'Selected Gemini model unavailable. Check GEMINI_MODEL.',
  image: "Couldn't analyze this image.",
  bad_request: 'The request was not valid.',
  server: 'AI service unavailable.',
  offline: 'You are offline. The basic coach still works.',
  aborted: 'Request cancelled.',
  no_model: 'Gemini is temporarily unavailable for this type of request.',
  cost_blocked: 'This model cannot be verified as Free Tier.',
};

export class AiClientError extends Error {
  constructor(
    public kind: AiErrorKind,
    message?: string,
    public quota?: QuotaInfo,
    public status = 0,
    /** Earliest time a model is expected to be available again (from Google's retry info). */
    public retryAt?: number,
  ) {
    super(message ?? CLIENT_ERROR_MESSAGES[kind]);
  }
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: Record<string, unknown>[];
}

export interface ChatResponse {
  content: GeminiContent;
  text: string;
  calls: { id?: string; name: string; args: Record<string, unknown> }[];
  model: string;
  usage: TokenUsage | null;
  routing?: RoutingInfo;
}

export type StatusState = 'not_configured' | 'connected' | 'invalid_key' | 'quota' | 'model' | 'server' | 'bad_request' | 'image' | 'offline' | 'no_model' | 'cost_blocked';

export interface StatusResponse {
  state: StatusState;
  provider: 'gemini';
  model: string;
  modelName?: string;
  resolvedModel?: string;
  tested?: boolean;
  message?: string;
  /** Token usage of the test request (only with test=1). The API exposes no quota: always null. */
  usage?: TokenUsage | null;
  quota?: QuotaInfo | null;
  /** Model router summary (counts of usable / healthy / rate-limited models). */
  router?: { mode: string; discovered: boolean; models: number; available: number; healthy: number; rateLimited: number; unavailable: number };
  routing?: RoutingInfo;
}

const inflight = new Map<string, Promise<unknown>>();

type ReqOpts = { signal?: AbortSignal; image?: boolean; dedupeKey?: string; intent?: RoutingPrefs['intent']; lastModel?: string; requestId?: string };

async function post<T extends { model?: string; usage?: TokenUsage | null; routing?: RoutingInfo }>(path: string, body: Record<string, unknown>, type: AiRequestType, opts: ReqOpts = {}): Promise<T> {
  const key = opts.dedupeKey ? `${path}:${opts.dedupeKey}` : undefined;
  if (key && inflight.has(key)) return inflight.get(key) as Promise<T>;
  const p = request<T>(path, body, type, opts);
  if (key) {
    inflight.set(key, p);
    void p.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  return p;
}

/** Routing preferences sent with every request: cost mode, health hints, continuity, request id. */
async function routingPrefs(opts: ReqOpts): Promise<RoutingPrefs> {
  const s = await settingsRepository.get().catch(() => undefined);
  return {
    freeTierOnly: s?.coach.ai.freeTierOnly !== false,
    hints: await currentHints(),
    requestId: opts.requestId ?? uid('r_'),
    ...(opts.lastModel ? { lastModel: opts.lastModel } : {}),
    ...(opts.intent ? { intent: opts.intent } : {}),
  };
}

const outcomeKind = (a: RoutingAttempt): string | undefined =>
  a.outcome === 'ok' ? undefined : a.outcome === 'rate_limited' || a.outcome === 'quota_exhausted' ? 'quota' : a.outcome === 'blocked' ? 'blocked' : a.outcome === 'unavailable' || a.outcome === 'unsupported' ? 'model' : 'server';

/** One usage record per model attempt (a fallback counts toward each model it touched). */
function attemptRecords(attempts: RoutingAttempt[], base: { ts: number; type: AiRequestType; image: boolean; requestType?: string }, usage?: TokenUsage | null): Omit<AiUsageRecord, 'id'>[] {
  return attempts.map((a, i) => ({
    ts: base.ts,
    model: a.model,
    type: base.type,
    requestType: base.requestType,
    fallback: i > 0,
    ok: a.outcome === 'ok',
    status: a.outcome === 'blocked' ? 0 : (a.status ?? (a.outcome === 'ok' ? 200 : a.outcome === 'rate_limited' || a.outcome === 'quota_exhausted' ? 429 : 500)),
    errorKind: outcomeKind(a),
    latencyMs: a.latencyMs,
    image: base.image,
    ...(a.quota ? { quota: a.quota } : {}),
    ...(a.outcome === 'ok' && usage ? { inputTokens: usage.inputTokens ?? undefined, outputTokens: usage.outputTokens ?? undefined, totalTokens: usage.totalTokens ?? undefined } : {}),
  }));
}

async function request<T extends { model?: string; usage?: TokenUsage | null; routing?: RoutingInfo }>(path: string, body: Record<string, unknown>, type: AiRequestType, opts: ReqOpts): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiClientError('offline');
  const started = Date.now();
  const routing = await routingPrefs(opts);
  const payload = JSON.stringify({ ...body, routing });
  let res: Response | undefined;
  // One retry on a dropped connection, with the SAME request id: the server answers a
  // repeated id from its cache, so a retry never costs quota twice or duplicates work.
  for (let i = 0; i < 2 && !res; i++) {
    try {
      res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: opts.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new AiClientError('aborted');
      if (i === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!res) {
    await recordUsage({ ts: started, model: '', type, ok: false, status: 0, errorKind: 'offline', latencyMs: Date.now() - started, image: !!opts.image });
    throw new AiClientError('offline', 'Could not reach the AI service. Check your connection.');
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON (e.g. the static host has no /api) → treated as not deployed
  }
  const usage = (data.usage as TokenUsage | null | undefined) ?? undefined;
  const err = data.error as { kind?: AiErrorKind; message?: string; quota?: QuotaInfo; routing?: { attempts?: RoutingAttempt[]; retryAt?: number } } | undefined;
  const kind: AiErrorKind | undefined = res.ok ? undefined : (err?.kind ?? (res.status === 404 ? 'not_configured' : 'server'));
  const info = data.routing as RoutingInfo | undefined;
  const attempts = info?.attempts ?? err?.routing?.attempts ?? [];
  if (attempts.length) {
    await recordUsageMany(attemptRecords(attempts, { ts: started, type, image: !!opts.image, requestType: info?.requestType }, usage));
    await noteRouting(attempts, { model: info?.model, reason: info?.reason, requestType: info?.requestType, fallback: info?.fallback });
  } else {
    await recordUsage({
      ts: started,
      model: String(data.model ?? ''),
      type,
      inputTokens: usage?.inputTokens ?? undefined,
      outputTokens: usage?.outputTokens ?? undefined,
      totalTokens: usage?.totalTokens ?? undefined,
      ok: res.ok,
      status: res.status,
      errorKind: kind,
      latencyMs: Date.now() - started,
      image: !!opts.image,
      quota: err?.quota,
    });
  }
  if (!res.ok) {
    const message = err?.message ?? (res.status === 404 ? 'The AI API is not deployed here (it runs on Vercel or `npm run dev`).' : `The AI function failed (HTTP ${res.status}). Check Vercel → Functions / Logs.`);
    throw new AiClientError(kind!, message, err?.quota, res.status, err?.routing?.retryAt);
  }
  return data as T;
}

export const geminiProvider = {
  id: 'gemini' as const,

  chat(req: ChatRequest, opts: { signal?: AbortSignal; intent?: RoutingPrefs['intent']; lastModel?: string; requestId?: string } = {}): Promise<ChatResponse> {
    const image = req.contents.some((c) => c.parts.some((p) => 'inlineData' in p));
    return post<ChatResponse>('/api/ai', req, 'chat', { ...opts, image });
  },

  analyzeFood(req: Extract<FoodRequest, { mode: 'analyze' }>, signal?: AbortSignal): Promise<{ estimate: FoodEstimate; model: string; usage: TokenUsage | null; routing?: RoutingInfo }> {
    return post('/api/food', req, 'food_analyze', { signal, image: true, dedupeKey: `${req.image.data.length}:${req.image.data.slice(-64)}:${req.note ?? ''}` });
  },

  reviseFood(req: Extract<FoodRequest, { mode: 'revise' }>, signal?: AbortSignal): Promise<{ estimate: FoodEstimate; model: string; usage: TokenUsage | null; routing?: RoutingInfo }> {
    return post('/api/food', req, 'food_revise', { signal, dedupeKey: JSON.stringify([req.message, req.estimate.foods]) });
  },

  explainFood(req: Extract<FoodRequest, { mode: 'explain' }>, signal?: AbortSignal): Promise<{ text: string; model: string; usage: TokenUsage | null }> {
    return post('/api/food', req, 'food_explain', { signal, dedupeKey: JSON.stringify([req.question, req.estimate.foods]) });
  },

  /** GET /api/status. `test` makes one tiny real request (counted in usage). */
  async status(test = false, signal?: AbortSignal): Promise<StatusResponse> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { state: 'offline', provider: 'gemini', model: '', message: CLIENT_ERROR_MESSAGES.offline };
    const started = Date.now();
    try {
      const free = (await settingsRepository.get().catch(() => undefined))?.coach.ai.freeTierOnly !== false;
      const q = new URLSearchParams({ ...(test ? { test: '1' } : {}), freeTierOnly: free ? '1' : '0' });
      const res = await fetch(`/api/status?${q}`, { signal, cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as StatusResponse | null;
      if (!data || typeof data.state !== 'string') {
        // Not JSON: either there is no /api here (static hosting, `npm run preview`) or the function crashed.
        if (res.ok || res.status === 404) return { state: 'not_configured', provider: 'gemini', model: '', message: 'The AI API is not deployed here (it runs on Vercel or `npm run dev`).' };
        return { state: 'server', provider: 'gemini', model: '', message: `The AI function failed to start (HTTP ${res.status}). Check Vercel → your deployment → Functions / Logs.` };
      }
      const attempts = data.routing?.attempts ?? [];
      if (test && attempts.length) {
        await recordUsageMany(attemptRecords(attempts, { ts: started, type: 'status_test', image: false, requestType: 'STATUS' }, data.usage));
        await noteRouting(attempts, { model: data.routing?.model, reason: data.routing?.reason, requestType: 'STATUS', fallback: data.routing?.fallback });
      } else if (test) {
        await recordUsage({
          ts: started,
          model: data.model,
          type: 'status_test',
          ok: data.state === 'connected',
          status: data.state === 'connected' ? 200 : data.state === 'quota' ? 429 : res.status,
          errorKind: data.state === 'connected' ? undefined : data.state,
          latencyMs: Date.now() - started,
          image: false,
          quota: data.quota ?? undefined,
        });
      }
      return data;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new AiClientError('aborted');
      return { state: 'offline', provider: 'gemini', model: '', message: 'Could not reach the AI service.' };
    }
  },

  /** GET /api/models: discovered models, capabilities, Free Tier status, routes. `refresh` re-lists from Google. */
  async models(refresh = false, signal?: AbortSignal): Promise<ModelsResponse | undefined> {
    try {
      const free = (await settingsRepository.get().catch(() => undefined))?.coach.ai.freeTierOnly !== false;
      const q = new URLSearchParams({ ...(refresh ? { refresh: '1' } : {}), freeTierOnly: free ? '1' : '0' });
      const res = await fetch(`/api/models?${q}`, { signal, cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as ModelsResponse | null;
      return data && Array.isArray(data.models) ? data : undefined;
    } catch {
      return undefined;
    }
  },
};

export type GeminiProvider = typeof geminiProvider;
