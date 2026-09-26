import type { HealthStatus, ModelHint, ModelLimits, ModelView, RoutingAttempt } from '@/ai/shared/models';
import { nextPacificMidnight } from '@/ai/shared/time';
import type { AiUsageRecord, AiUsageSettings } from '@/types';

/**
 * Per-model view of the app's own request log, for the router and the settings
 * screen. Everything here is an APP ESTIMATE (requests from this device); the only
 * authoritative numbers are the limits Google itself reports in 429 errors.
 */

export interface ModelUsage {
  model: string;
  requests: number;
  ok: number;
  failed: number;
  rateLimits: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  minuteRequests: number;
  minuteTokens: number;
  /** Requests since the last Pacific-time midnight (Google's RPD window). */
  dayRequests: number;
  recentErrors: number;
  lastSuccess?: number;
  lastRateLimit?: number;
}

/** Local memory of each model's health, fed by the routing info of every response. */
export interface ModelHealthRecord {
  status: HealthStatus;
  cooldownUntil?: number;
  lastSuccess?: number;
  lastRateLimit?: number;
  lastError?: string;
  /** Limits Google reported in 429 details (authoritative). */
  learned: ModelLimits;
}

export interface RouterStats {
  currentModel?: string;
  lastModel?: string;
  lastReason?: string;
  lastRequestType?: string;
  fallbackCount: number;
  rateLimits: number;
  lastErrors: { ts: number; model: string; outcome: string; status?: number }[];
  health: Record<string, ModelHealthRecord>;
}

export const EMPTY_STATS: RouterStats = { fallbackCount: 0, rateLimits: 0, lastErrors: [], health: {} };

const reachedGoogle = (r: AiUsageRecord) => r.status !== 0 && r.errorKind !== 'not_configured' && r.errorKind !== 'bad_request' && r.errorKind !== 'blocked';

export function modelUsage(records: AiUsageRecord[], now = Date.now()): Record<string, ModelUsage> {
  const dayStart = nextPacificMidnight(now) - 86_400_000;
  const out: Record<string, ModelUsage> = {};
  for (const r of records) {
    if (!r.model || !reachedGoogle(r) || r.ts > now) continue;
    const u = (out[r.model] ??= { model: r.model, requests: 0, ok: 0, failed: 0, rateLimits: 0, errors: 0, inputTokens: 0, outputTokens: 0, minuteRequests: 0, minuteTokens: 0, dayRequests: 0, recentErrors: 0 });
    u.requests += 1;
    const tokens = r.totalTokens ?? (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
    u.inputTokens += r.inputTokens ?? 0;
    u.outputTokens += r.outputTokens ?? 0;
    if (r.ok) {
      u.ok += 1;
      u.lastSuccess = Math.max(u.lastSuccess ?? 0, r.ts);
    } else {
      u.failed += 1;
      if (r.errorKind === 'quota' || r.status === 429) {
        u.rateLimits += 1;
        u.lastRateLimit = Math.max(u.lastRateLimit ?? 0, r.ts);
      } else u.errors += 1;
      if (now - r.ts < 5 * 60_000) u.recentErrors += 1;
    }
    if (now - r.ts < 60_000) {
      u.minuteRequests += 1;
      u.minuteTokens += tokens;
    }
    if (r.ts >= dayStart) u.dayRequests += 1;
  }
  return out;
}

/** Player limits (from AI Studio) overridden by Google's own reported limits. */
export function effectiveLimits(model: string, settings: AiUsageSettings, stats: RouterStats): ModelLimits {
  return { ...(settings.modelLimits?.[model] ?? {}), ...(stats.health[model]?.learned ?? {}) };
}

/** Compact per-model hints for the server router (only ever used to avoid models). */
export function buildHints(records: AiUsageRecord[], settings: AiUsageSettings, stats: RouterStats, now = Date.now()): Record<string, ModelHint> {
  const usage = modelUsage(records, now);
  const ids = new Set([...Object.keys(usage), ...Object.keys(stats.health), ...Object.keys(settings.modelLimits ?? {})]);
  const hints: Record<string, ModelHint> = {};
  for (const id of [...ids].slice(0, 40)) {
    const u = usage[id];
    const h = stats.health[id];
    const limits = effectiveLimits(id, settings, stats);
    const hint: ModelHint = {};
    if (h?.cooldownUntil && h.cooldownUntil > now) {
      hint.cooldownUntil = h.cooldownUntil;
      hint.status = h.status;
    }
    if (u) Object.assign(hint, { minuteRequests: u.minuteRequests, minuteTokens: u.minuteTokens, dayRequests: u.dayRequests, recentErrors: u.recentErrors });
    if (Object.keys(limits).length) hint.limits = limits;
    if (Object.keys(hint).length) hints[id] = hint;
  }
  return hints;
}

/** Update local health and stats from a response's routing info (success or failure). */
export function applyAttempts(stats: RouterStats, attempts: RoutingAttempt[], final: { model?: string; reason?: string; requestType?: string; fallback?: boolean }, now = Date.now()): RouterStats {
  const next: RouterStats = { ...stats, health: { ...stats.health }, lastErrors: [...stats.lastErrors] };
  for (const a of attempts) {
    const h: ModelHealthRecord = { ...(next.health[a.model] ?? { status: 'UNKNOWN', learned: {} }) };
    h.learned = { ...h.learned };
    if (a.outcome === 'ok') {
      Object.assign(h, { status: 'AVAILABLE', cooldownUntil: undefined, lastSuccess: now, lastError: undefined });
    } else if (a.outcome !== 'blocked') {
      if (a.outcome === 'rate_limited' || a.outcome === 'quota_exhausted') {
        next.rateLimits += 1;
        h.lastRateLimit = now;
        const q = a.quota;
        if (q?.quotaValue && (q.limitType === 'rpm' || q.limitType === 'tpm' || q.limitType === 'rpd')) h.learned[q.limitType] = q.quotaValue;
      }
      h.status = a.outcome === 'rate_limited' ? 'RATE_LIMITED' : a.outcome === 'quota_exhausted' ? 'QUOTA_EXHAUSTED' : a.outcome === 'unavailable' || a.outcome === 'unsupported' ? 'UNSUPPORTED' : a.outcome === 'transient' ? 'BUSY' : 'ERROR';
      if (a.cooldownUntil) h.cooldownUntil = a.cooldownUntil;
      h.lastError = `${a.outcome.replace('_', ' ')}${a.status ? ` (${a.status})` : ''}`;
      next.lastErrors = [{ ts: now, model: a.model, outcome: a.outcome, status: a.status }, ...next.lastErrors].slice(0, 8);
    }
    next.health[a.model] = h;
  }
  if (final.model) {
    if (next.currentModel && next.currentModel !== final.model) next.lastModel = next.currentModel;
    next.currentModel = final.model;
  }
  if (final.reason) next.lastReason = final.reason;
  if (final.requestType) next.lastRequestType = final.requestType;
  if (final.fallback) next.fallbackCount += 1;
  return next;
}

export type ModelIndicator = { icon: string; label: string; tone: 'ok' | 'notice' | 'warn' | 'bad' | 'off' };

/** 🟢 Healthy · 🟡 High usage · 🟠 Near limit · 🔴 Rate limited · ⚫ Unavailable */
export function modelIndicator(view: Pick<ModelView, 'usable' | 'health' | 'cooldownUntil'>, local: ModelHealthRecord | undefined, usage: ModelUsage | undefined, limits: ModelLimits, now = Date.now()): ModelIndicator {
  if (!view.usable) return { icon: '⚫', label: 'Unavailable', tone: 'off' };
  const cooldown = Math.max(view.cooldownUntil ?? 0, local?.cooldownUntil ?? 0);
  if (cooldown > now) {
    const st = local?.cooldownUntil === cooldown ? local.status : view.health;
    return st === 'UNSUPPORTED' ? { icon: '⚫', label: 'Unavailable', tone: 'off' } : { icon: '🔴', label: st === 'QUOTA_EXHAUSTED' ? 'Daily limit reached' : 'Rate limited', tone: 'bad' };
  }
  const ratio = (used?: number, limit?: number | 'unlimited') => (typeof limit === 'number' && used !== undefined ? used / limit : 0);
  const worst = Math.max(ratio(usage?.dayRequests, limits.rpd), ratio(usage?.minuteRequests, limits.rpm), ratio(usage?.minuteTokens, limits.tpm));
  if (worst >= 0.9) return { icon: '🟠', label: 'Near limit', tone: 'warn' };
  if (worst >= 0.7) return { icon: '🟡', label: 'High usage', tone: 'notice' };
  return { icon: '🟢', label: 'Healthy', tone: 'ok' };
}

export function formatLimit(v?: number | 'unlimited'): string {
  return v === undefined ? 'Unknown' : v === 'unlimited' ? 'Unlimited' : v.toLocaleString();
}

export interface Pressure {
  model: string;
  key: 'rpm' | 'tpm' | 'rpd';
  used: number;
  limit: number;
  pct: number;
  remaining: number;
}

/** The limit a model is closest to (only against known numeric limits — never invented). */
export function modelPressure(model: string, usage: ModelUsage | undefined, limits: ModelLimits): Pressure | undefined {
  if (!usage) return undefined;
  const list: Pressure[] = [];
  const add = (key: Pressure['key'], used: number, limit?: LimitValueLike) => {
    if (typeof limit !== 'number') return;
    list.push({ model, key, used, limit, pct: Math.round((used / limit) * 100), remaining: Math.max(0, limit - used) });
  };
  add('rpd', usage.dayRequests, limits.rpd);
  add('rpm', usage.minuteRequests, limits.rpm);
  add('tpm', usage.minuteTokens, limits.tpm);
  return list.sort((a, b) => b.pct - a.pct)[0];
}
type LimitValueLike = number | 'unlimited' | undefined;

/**
 * Coach header status: 🟢 AI Ready · 🟡 Usage high · 🟠 Approaching limit · 🔴 Limit reached.
 * "Limit reached" only when every usable model is cooling down (the router has nowhere to go).
 */
export function routerBadge(input: { connected: boolean; quota: boolean; models?: Pick<ModelView, 'id' | 'usable' | 'cooldownUntil'>[]; stats: RouterStats; perModel: Record<string, ModelUsage>; usage: AiUsageSettings; now?: number }): ModelIndicator {
  const now = input.now ?? Date.now();
  if (!input.connected) return input.quota ? { icon: '🔴', label: 'Limit reached', tone: 'bad' } : { icon: '⚪', label: 'Basic coach', tone: 'off' };
  const usable = (input.models ?? []).filter((m) => m.usable);
  const cooling = (m: { id: string; cooldownUntil?: number }) => Math.max(m.cooldownUntil ?? 0, input.stats.health[m.id]?.cooldownUntil ?? 0) > now;
  if (usable.length && usable.every(cooling)) return { icon: '🔴', label: 'Limit reached', tone: 'bad' };
  const current = input.stats.currentModel && usable.some((m) => m.id === input.stats.currentModel) ? input.stats.currentModel : usable.find((m) => !cooling(m))?.id;
  const p = current ? modelPressure(current, input.perModel[current], effectiveLimits(current, input.usage, input.stats)) : undefined;
  if (p && p.pct >= input.usage.thresholds.critical) return { icon: '🟠', label: 'Approaching limit', tone: 'warn' };
  if (p && p.pct >= input.usage.thresholds.notice) return { icon: '🟡', label: 'Usage high', tone: 'notice' };
  return { icon: '🟢', label: 'AI Ready', tone: 'ok' };
}
