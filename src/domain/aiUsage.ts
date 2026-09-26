import type { AiUsageRecord, AiUsageSettings } from '@/types';

/**
 * Gemini usage estimates from the app's own request log.
 * Everything here is an APP ESTIMATE: requests made through LifeForge on this device.
 * Google AI Studio → Usage stays the authoritative source; the app never invents a
 * remaining quota. Percentages exist only against limits the player entered.
 */

export interface PeriodUsage {
  requests: number;
  failed: number;
  imageRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Requests whose token counts Gemini did not report. */
  missingTokens: number;
}

export type UsageLevel = 'unknown' | 'low' | 'moderate' | 'high' | 'near' | 'reached';
export type LimitKey = 'rpm' | 'tpm' | 'rpd';

export interface LimitStatus {
  key: LimitKey;
  used: number;
  limit: number;
  pct: number;
  remaining: number;
  level: UsageLevel;
}

export interface QuotaHit {
  ts: number;
  limitType?: string;
  quotaValue?: number;
  retryAfterSec?: number;
  /** When Google said it can be retried (ts + retryAfterSec), if known. */
  retryAt?: number;
}

export interface UsageSummary {
  today: PeriodUsage;
  last24h: PeriodUsage;
  week: PeriodUsage;
  month: PeriodUsage;
  lastMinute: PeriodUsage;
  /** Average requests per active day (only with ≥ 3 days of data). */
  perDay?: number;
  /** Share of requests that were food vision (only with ≥ 5 requests). */
  foodShare?: number;
  limits: LimitStatus[];
  level: UsageLevel;
  /** The limit closest to its maximum. */
  worst?: LimitStatus;
  /** Latest quota error in the last 24 h (Google's own details). */
  quotaHit?: QuotaHit;
  /** True while a recent quota error is still in force. */
  limitReached: boolean;
  lastModel?: string;
  firstTs?: number;
}

const empty = (): PeriodUsage => ({ requests: 0, failed: 0, imageRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, missingTokens: 0 });

export function sumPeriod(records: AiUsageRecord[]): PeriodUsage {
  const p = empty();
  for (const r of records) {
    p.requests += 1;
    if (!r.ok) p.failed += 1;
    if (r.image) p.imageRequests += 1;
    if (r.totalTokens === undefined && r.inputTokens === undefined) p.missingTokens += 1;
    p.inputTokens += r.inputTokens ?? 0;
    p.outputTokens += r.outputTokens ?? 0;
    p.totalTokens += r.totalTokens ?? (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
  }
  return p;
}

/** Requests that reached Google (network errors and local validation errors do not count). */
const reachedGoogle = (r: AiUsageRecord) => r.status !== 0 && r.errorKind !== 'not_configured' && r.errorKind !== 'bad_request';

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const dow = (d.getDay() + 6) % 7; // Monday first
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

function startOfMonth(ts: number): number {
  const d = new Date(startOfDay(ts));
  d.setDate(1);
  return d.getTime();
}

export function levelFor(pct: number, t: AiUsageSettings['thresholds']): UsageLevel {
  if (pct >= 100) return 'reached';
  if (pct >= t.critical) return 'near';
  if (pct >= t.warning) return 'high';
  if (pct >= t.notice) return 'moderate';
  return 'low';
}

/**
 * Summarise the local log. `limits` are the player's own numbers from AI Studio;
 * without them no percentage is computed (level stays "unknown" unless Google
 * itself reported a quota error).
 */
export function summarizeUsage(all: AiUsageRecord[], settings: AiUsageSettings, now = Date.now()): UsageSummary {
  const records = all.filter(reachedGoogle).sort((a, b) => a.ts - b.ts);
  const since = (ts: number) => records.filter((r) => r.ts >= ts && r.ts <= now);
  const today = sumPeriod(since(startOfDay(now)));
  const lastMinute = sumPeriod(since(now - 60_000));
  const last24h = sumPeriod(since(now - 86_400_000));

  const limits: LimitStatus[] = [];
  const add = (key: LimitKey, used: number, limit?: number) => {
    if (!limit || limit <= 0) return;
    const pct = Math.round((used / limit) * 100);
    limits.push({ key, used, limit, pct, remaining: Math.max(0, limit - used), level: levelFor(pct, settings.thresholds) });
  };
  add('rpm', lastMinute.requests, settings.limits.rpm);
  add('tpm', lastMinute.totalTokens, settings.limits.tpm);
  add('rpd', today.requests, settings.limits.rpd);

  const quotaRec = [...records].reverse().find((r) => r.errorKind === 'quota' && r.ts >= now - 86_400_000);
  let quotaHit: QuotaHit | undefined;
  if (quotaRec) {
    const retryAt = quotaRec.quota?.retryAfterSec !== undefined ? quotaRec.ts + quotaRec.quota.retryAfterSec * 1000 : undefined;
    quotaHit = { ts: quotaRec.ts, limitType: quotaRec.quota?.limitType, quotaValue: quotaRec.quota?.quotaValue, retryAfterSec: quotaRec.quota?.retryAfterSec, retryAt };
  }
  const lastOk = [...records].reverse().find((r) => r.ok);
  // A quota error stays "in force" until Google's retry time, or until a later request succeeds.
  const limitReached = !!quotaHit && (!lastOk || lastOk.ts < quotaHit.ts) && (quotaHit.retryAt === undefined ? now - quotaHit.ts < 60 * 60_000 : now < quotaHit.retryAt);

  const worst = [...limits].sort((a, b) => b.pct - a.pct)[0];
  const level: UsageLevel = limitReached ? 'reached' : (worst?.level ?? 'unknown');

  const days = new Set(records.map((r) => startOfDay(r.ts))).size;
  const month = sumPeriod(since(startOfMonth(now)));
  const all30 = since(now - 30 * 86_400_000);
  const perDay = days >= 3 ? Math.round((all30.length / Math.max(1, new Set(all30.map((r) => startOfDay(r.ts))).size)) * 10) / 10 : undefined;
  const food = all30.filter((r) => r.type.startsWith('food_')).length;
  const foodShare = all30.length >= 5 ? Math.round((food / all30.length) * 100) : undefined;

  return {
    today,
    last24h,
    week: sumPeriod(since(startOfWeek(now))),
    month,
    lastMinute,
    perDay,
    foodShare,
    limits,
    level,
    worst,
    quotaHit,
    limitReached,
    lastModel: records.at(-1)?.model,
    firstTs: records[0]?.ts,
  };
}

/** Coach badge: a readable state without pretending to know Google's numbers. */
export function usageBadge(s: Pick<UsageSummary, 'level' | 'limitReached'>, connected: boolean): { icon: string; label: string; tone: 'ok' | 'notice' | 'warn' | 'bad' | 'off' } {
  if (s.limitReached || s.level === 'reached') return { icon: '🔴', label: 'Limit reached', tone: 'bad' };
  if (!connected) return { icon: '⚪', label: 'Basic coach', tone: 'off' };
  if (s.level === 'near' || s.level === 'high') return { icon: '🟠', label: 'Approaching limit', tone: 'warn' };
  if (s.level === 'moderate') return { icon: '🟡', label: 'Usage high', tone: 'notice' };
  return { icon: '🟢', label: 'Gemini OK', tone: 'ok' };
}

export const LIMIT_LABEL: Record<string, string> = {
  rpm: 'RPM · requests per minute',
  tpm: 'TPM · tokens per minute',
  rpd: 'RPD · requests per day',
  tpd: 'Tokens per day',
  other: 'Another Gemini limit',
};
