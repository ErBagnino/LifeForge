import type { FoodEstimate, FoodRequest } from '@/ai/shared/food';
import type { ChatRequest } from '@/ai/shared/tools';
import type { AiRequestType } from '@/types';
import { recordUsage } from './usageService';

/**
 * Client side of the Gemini integration. The app only talks to its own serverless
 * API (/api/*); the Gemini API key exists only on the server (Vercel env var).
 */

export type AiErrorKind = 'not_configured' | 'invalid_key' | 'quota' | 'model' | 'image' | 'bad_request' | 'server' | 'offline' | 'aborted';

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
};

export class AiClientError extends Error {
  constructor(
    public kind: AiErrorKind,
    message?: string,
    public quota?: QuotaInfo,
    public status = 0,
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
}

export type StatusState = 'not_configured' | 'connected' | 'invalid_key' | 'quota' | 'model' | 'server' | 'bad_request' | 'image' | 'offline';

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
}

const inflight = new Map<string, Promise<unknown>>();

async function post<T extends { model?: string; usage?: TokenUsage | null }>(path: string, body: unknown, type: AiRequestType, opts: { signal?: AbortSignal; image?: boolean; dedupeKey?: string } = {}): Promise<T> {
  const key = opts.dedupeKey ? `${path}:${opts.dedupeKey}` : undefined;
  if (key && inflight.has(key)) return inflight.get(key) as Promise<T>;
  const p = request<T>(path, body, type, opts);
  if (key) {
    inflight.set(key, p);
    void p.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  return p;
}

async function request<T extends { model?: string; usage?: TokenUsage | null }>(path: string, body: unknown, type: AiRequestType, opts: { signal?: AbortSignal; image?: boolean }): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiClientError('offline');
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiClientError('aborted');
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
  const err = data.error as { kind?: AiErrorKind; message?: string; quota?: QuotaInfo } | undefined;
  const kind: AiErrorKind | undefined = res.ok ? undefined : (err?.kind ?? (res.status === 404 ? 'not_configured' : 'server'));
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
  if (!res.ok) {
    const message = kind === 'not_configured' && !err ? 'The AI API is not deployed here (it runs on Vercel or `npm run dev`).' : err?.message;
    throw new AiClientError(kind!, message, err?.quota, res.status);
  }
  return data as T;
}

export const geminiProvider = {
  id: 'gemini' as const,

  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const image = req.contents.some((c) => c.parts.some((p) => 'inlineData' in p));
    return post<ChatResponse>('/api/ai', req, 'chat', { signal, image });
  },

  analyzeFood(req: Extract<FoodRequest, { mode: 'analyze' }>, signal?: AbortSignal): Promise<{ estimate: FoodEstimate; model: string; usage: TokenUsage | null }> {
    return post('/api/food', req, 'food_analyze', { signal, image: true, dedupeKey: `${req.image.data.length}:${req.image.data.slice(-64)}:${req.note ?? ''}` });
  },

  reviseFood(req: Extract<FoodRequest, { mode: 'revise' }>, signal?: AbortSignal): Promise<{ estimate: FoodEstimate; model: string; usage: TokenUsage | null }> {
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
      const res = await fetch(`/api/status${test ? '?test=1' : ''}`, { signal, cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as StatusResponse | null;
      if (!data || typeof data.state !== 'string') return { state: 'not_configured', provider: 'gemini', model: '', message: 'The AI API is not deployed here (it runs on Vercel or `npm run dev`).' };
      if (test) {
        await recordUsage({
          ts: started,
          model: data.model,
          type: 'status_test',
          inputTokens: data.usage?.inputTokens ?? undefined,
          outputTokens: data.usage?.outputTokens ?? undefined,
          totalTokens: data.usage?.totalTokens ?? undefined,
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
};

export type GeminiProvider = typeof geminiProvider;
