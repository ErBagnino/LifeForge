import type { RequestType, RoutingAttempt, RoutingInfo } from '../../src/ai/shared/models.js';
import { classifyError, quotaDetail } from './errors.js';
import type { RegistryModel } from './registry.js';
import { costGuard, recordOutcome, type Selection } from './router.js';

/**
 * Runs one request through the chain chosen by the router:
 * - Cost Guard re-checked right before every call;
 * - 429 → cooldown for that model, go straight to the next compatible model;
 * - transient errors (5xx, network, timeout) → up to MAX_RETRIES with exponential backoff;
 * - model gone / feature unsupported → mark it and fall back;
 * - invalid key or a malformed request → stop (another model wouldn't help).
 * Generating is side-effect free (tools run in the app after the answer), so a retry
 * can never duplicate a tool action.
 */

export const MAX_RETRIES = 2;
export const MAX_MODELS = 4;
const BASE_BACKOFF_MS = 400;
const ATTEMPT_TIMEOUT_MS = 20_000;
const DEADLINE_MS = 26_000; // Vercel maxDuration is 30 s

export class RouterError extends Error {
  constructor(
    public kind: 'no_model' | 'cost_blocked' | 'invalid_key' | 'bad_request' | 'image' | 'quota',
    public attempts: RoutingAttempt[],
    public cause?: unknown,
    public retryAt?: number,
  ) {
    super(kind);
  }
}

export interface ExecOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  freeTierOnly: boolean;
  allowPaid: boolean;
  context: 'chat' | 'food' | 'status';
  log?: (event: Record<string, unknown>) => void;
}

/** Overridable in tests (backoff waits). */
export const execConfig = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('Request timed out'), { status: 504 })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type Failure = { outcome: RoutingAttempt['outcome']; stop?: RouterError['kind']; signature?: boolean };

function classifyFailure(e: unknown, context: ExecOptions['context']): Failure {
  const status = (e as { status?: number })?.status;
  const msg = String((e as Error)?.message ?? '').toLowerCase();
  if (/thought.?signature/.test(msg)) return { outcome: 'error', signature: true };
  const kind = classifyError(e, context === 'status' ? 'status' : context);
  if (kind === 'invalid_key') return { outcome: 'error', stop: 'invalid_key' };
  if (kind === 'quota') return { outcome: quotaDetail(e).limitType === 'rpd' || quotaDetail(e).quotaValue === 0 ? 'quota_exhausted' : 'rate_limited' };
  if (kind === 'model') return { outcome: 'unavailable' };
  if (/not supported|does not support|is not enabled|unsupported|not available for this model/.test(msg)) return { outcome: 'unsupported' };
  if (kind === 'image') return { outcome: 'error', stop: 'image' };
  if (kind === 'bad_request') return { outcome: 'error', stop: 'bad_request' };
  if (status === undefined || status >= 500 || status === 408) return { outcome: 'transient' };
  return { outcome: 'error' };
}

/**
 * Remove thought signatures produced by another model. If the new model still insists
 * (Gemini 3 validates them), retry once with Google's documented skip value.
 */
export function sanitizeSignatures<T>(contents: T, mode: 'strip' | 'skip'): T {
  if (!Array.isArray(contents)) return contents;
  return contents.map((c: { parts?: Record<string, unknown>[] }) => ({
    ...c,
    parts: c.parts?.map((p) => {
      const { thoughtSignature: _drop, ...rest } = p;
      void _drop;
      return mode === 'skip' && 'functionCall' in rest ? { ...rest, thoughtSignature: 'skip_thought_signature_validator' } : rest;
    }),
  })) as T;
}

export async function runRouted<R>(
  selection: Selection,
  requestType: RequestType,
  call: (model: RegistryModel, variant: 'as-is' | 'strip' | 'skip') => Promise<R>,
  opts: ExecOptions & { producedBy?: string },
): Promise<{ result: R; model: RegistryModel; routing: RoutingInfo }> {
  const sleep = opts.sleep ?? execConfig.sleep;
  const now = opts.now ?? Date.now;
  const started = now();
  const attempts: RoutingAttempt[] = [];
  const chain = selection.chain.slice(0, MAX_MODELS);
  if (!chain.length) {
    const retryAt = undefined;
    throw new RouterError(selection.blockedByCost ? 'cost_blocked' : 'no_model', attempts, undefined, retryAt);
  }
  let lastQuota = false;

  for (const model of chain) {
    const guard = costGuard(model, opts.freeTierOnly, opts.allowPaid);
    if (!guard.ok) {
      attempts.push({ model: model.id, outcome: 'blocked', latencyMs: 0 });
      continue;
    }
    // Contents from another model: drop its thought signatures first.
    let variant: 'as-is' | 'strip' | 'skip' = opts.producedBy && opts.producedBy !== model.id ? 'strip' : 'as-is';
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      if (now() - started > DEADLINE_MS) break;
      const t0 = now();
      try {
        const result = await withTimeout(call(model, variant), ATTEMPT_TIMEOUT_MS);
        const ok: RoutingAttempt = { model: model.id, outcome: 'ok', latencyMs: now() - t0 };
        recordOutcome(model.id, ok, now());
        attempts.push(ok);
        const first = chain[0].id;
        const routing: RoutingInfo = {
          requestType,
          model: model.id,
          reason: model.id === first ? (selection.reasons[model.id] ?? 'Best compatible available model') : `${first} failed (${attempts.find((a) => a.model === first)?.outcome.replace('_', ' ') ?? 'error'}); switched to fallback ${model.id}`,
          fallback: attempts.some((a) => a.outcome !== 'ok'),
          attempts,
          freeTierOnly: opts.freeTierOnly,
        };
        opts.log?.({ evt: 'ai_request', requestType, model: model.id, status: 'ok', latencyMs: now() - started, fallback: routing.fallback, attempts: attempts.length });
        return { result, model, routing };
      } catch (e) {
        const f = classifyFailure(e, opts.context);
        const status = (e as { status?: number })?.status;
        if (f.signature && variant !== 'skip') {
          variant = variant === 'as-is' ? 'strip' : 'skip';
          continue; // same model, cleaned contents; not counted as a retry of a transient error
        }
        const q = f.outcome === 'rate_limited' || f.outcome === 'quota_exhausted' ? quotaDetail(e) : undefined;
        const attempt: RoutingAttempt = { model: model.id, outcome: f.outcome, status, latencyMs: now() - t0, ...(q ? { quota: q } : {}) };
        attempts.push(attempt);
        opts.log?.({ evt: 'ai_attempt', requestType, model: model.id, outcome: f.outcome, status, latencyMs: attempt.latencyMs });
        if (f.stop) {
          throw new RouterError(f.stop, attempts, e);
        }
        if (f.outcome === 'transient' && retry < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** retry);
          continue;
        }
        attempt.cooldownUntil = recordOutcome(model.id, attempt, now());
        lastQuota = f.outcome === 'rate_limited' || f.outcome === 'quota_exhausted';
        break; // next model
      }
    }
    if (now() - started > DEADLINE_MS) break;
  }
  const retryAt = attempts.map((a) => a.cooldownUntil ?? Infinity).reduce((m, v) => Math.min(m, v), Infinity);
  opts.log?.({ evt: 'ai_request', requestType, status: 'failed', latencyMs: now() - started, attempts: attempts.length });
  throw new RouterError(lastQuota && attempts.every((a) => a.outcome !== 'transient') ? 'quota' : 'no_model', attempts, undefined, Number.isFinite(retryAt) ? retryAt : undefined);
}
