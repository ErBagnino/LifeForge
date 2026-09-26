/** Error kinds the app understands. Messages are safe to show to the user. */
export type AiErrorKind = 'not_configured' | 'invalid_key' | 'quota' | 'model' | 'image' | 'bad_request' | 'server' | 'no_model' | 'cost_blocked';

export const ERROR_MESSAGES: Record<AiErrorKind, string> = {
  not_configured: 'Gemini is not connected yet. Add GEMINI_API_KEY in Vercel and redeploy.',
  invalid_key: 'Gemini connection failed. Check your API key.',
  quota: 'Gemini is temporarily unavailable because a usage limit has been reached.',
  model: 'Selected Gemini model unavailable. Check GEMINI_MODEL.',
  image: "Couldn't analyze this image.",
  bad_request: 'The request was not valid.',
  server: 'AI service unavailable.',
  no_model: 'Gemini is temporarily unavailable for this type of request.',
  cost_blocked: 'This model cannot be verified as Free Tier.',
};

export const ERROR_STATUS: Record<AiErrorKind, number> = {
  not_configured: 503,
  invalid_key: 401,
  quota: 429,
  model: 404,
  image: 422,
  bad_request: 400,
  server: 502,
  no_model: 503,
  cost_blocked: 403,
};

export class AiFailure extends Error {
  constructor(
    public kind: AiErrorKind,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[kind]);
  }
}

/** Map a Gemini SDK / network error to an AiErrorKind without leaking details. */
export function classifyError(err: unknown, context: 'chat' | 'food' | 'status' = 'chat'): AiErrorKind {
  if (err instanceof AiFailure) return err.kind;
  const e = err as { status?: number; message?: string; name?: string };
  const status = typeof e?.status === 'number' ? e.status : undefined;
  const msg = String(e?.message ?? '').toLowerCase();
  if (status === 429 || msg.includes('resource_exhausted') || msg.includes('quota')) return 'quota';
  if (msg.includes('api key not valid') || msg.includes('api_key_invalid') || msg.includes('invalid api key') || status === 401 || status === 403) return 'invalid_key';
  if (status === 404 || (msg.includes('model') && (msg.includes('not found') || msg.includes('not supported')))) return 'model';
  if (status === 400 && context === 'food' && (msg.includes('image') || msg.includes('inline_data') || msg.includes('mime'))) return 'image';
  if (status === 400) return 'bad_request';
  return 'server';
}

/** Which Google limit a 429 refers to, when Google says so in the error details. */
export type LimitType = 'rpm' | 'tpm' | 'rpd' | 'tpd' | 'other';

export interface QuotaDetail {
  /** From Google's `quotaId` / `quotaMetric`, e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier. */
  limitType?: LimitType;
  quotaId?: string;
  /** The limit value Google reported for that quota (authoritative when present). */
  quotaValue?: number;
  /** Google's RetryInfo.retryDelay, in seconds. */
  retryAfterSec?: number;
}

/**
 * Extract the authoritative bits of a Gemini 429 (RESOURCE_EXHAUSTED): Google includes
 * QuotaFailure / RetryInfo details in the error body. Nothing is guessed: missing
 * fields stay undefined.
 */
export function quotaDetail(err: unknown): QuotaDetail {
  const msg = String((err as { message?: string })?.message ?? '');
  const out: QuotaDetail = {};
  const retry = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(msg);
  if (retry) out.retryAfterSec = Math.ceil(Number(retry[1]));
  const id = /"quotaId"\s*:\s*"([^"]+)"/.exec(msg)?.[1];
  const metric = /"quotaMetric"\s*:\s*"([^"]+)"/.exec(msg)?.[1];
  const value = /"quotaValue"\s*:\s*"?(\d+)"?/.exec(msg)?.[1];
  if (id) out.quotaId = id.slice(0, 120);
  if (value) out.quotaValue = Number(value);
  const key = `${id ?? ''} ${metric ?? ''}`.toLowerCase();
  if (key.trim()) {
    const tokens = key.includes('token');
    if (key.includes('perday')) out.limitType = tokens ? 'tpd' : 'rpd';
    else if (key.includes('perminute')) out.limitType = tokens ? 'tpm' : 'rpm';
    else out.limitType = 'other';
  }
  return out;
}
