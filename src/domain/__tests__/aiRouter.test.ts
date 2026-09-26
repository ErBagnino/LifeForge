import { describe, expect, it } from 'vitest';
import type { AiUsageRecord, AiUsageSettings } from '@/types';
import { applyAttempts, buildHints, EMPTY_STATS, formatLimit, modelIndicator, modelPressure, modelUsage, routerBadge } from '../aiRouter';

const NOW = Date.UTC(2026, 8, 23, 17, 0, 0); // 10:00 Pacific
const usage: AiUsageSettings = { tracking: true, limits: {}, modelLimits: {}, thresholds: { notice: 70, warning: 85, critical: 95 } };
let n = 0;
const rec = (model: string, minsAgo: number, patch: Partial<AiUsageRecord> = {}): AiUsageRecord => ({ id: `u${++n}`, ts: NOW - minsAgo * 60_000, model, type: 'chat', inputTokens: 900, outputTokens: 100, totalTokens: 1000, ok: true, status: 200, latencyMs: 500, image: false, ...patch });

describe('per-model usage (app estimate)', () => {
  it('counts per model, per minute and per Pacific day; blocked/offline attempts are not Gemini requests', () => {
    const u = modelUsage([rec('a', 0.2), rec('a', 30), rec('a', 60 * 11), rec('b', 1, { ok: false, status: 429, errorKind: 'quota' }), rec('c', 1, { status: 0, errorKind: 'blocked', ok: false })], NOW);
    expect(u.a).toMatchObject({ requests: 3, minuteRequests: 1, minuteTokens: 1000, dayRequests: 2, ok: 3 });
    expect(u.b).toMatchObject({ rateLimits: 1, recentErrors: 1 });
    expect(u.c).toBeUndefined();
  });

  it('hints carry cooldowns, usage and known limits; Google limits override the player’s', () => {
    const stats = applyAttempts(EMPTY_STATS, [{ model: 'a', outcome: 'rate_limited', latencyMs: 1, status: 429, quota: { limitType: 'rpm', quotaValue: 10, retryAfterSec: 30 }, cooldownUntil: NOW + 30_000 }], {}, NOW);
    const hints = buildHints([rec('a', 0.1)], { ...usage, modelLimits: { a: { rpm: 99, rpd: 250 } } }, stats, NOW);
    expect(hints.a).toMatchObject({ status: 'RATE_LIMITED', cooldownUntil: NOW + 30_000, minuteRequests: 1, limits: { rpm: 10, rpd: 250 } });
    expect(stats).toMatchObject({ rateLimits: 1, lastErrors: [{ model: 'a', outcome: 'rate_limited', status: 429 }] });
  });

  it('tracks current/last model, fallback count and selection reason', () => {
    let s = applyAttempts(EMPTY_STATS, [{ model: 'a', outcome: 'ok', latencyMs: 1 }], { model: 'a', reason: 'Best compatible available model' }, NOW);
    s = applyAttempts(s, [{ model: 'a', outcome: 'transient', latencyMs: 1, status: 503 }, { model: 'b', outcome: 'ok', latencyMs: 1 }], { model: 'b', reason: 'a failed; switched to fallback b', fallback: true }, NOW);
    expect(s).toMatchObject({ currentModel: 'b', lastModel: 'a', fallbackCount: 1, lastReason: 'a failed; switched to fallback b' });
    expect(s.health.a.status).toBe('BUSY');
    expect(s.health.b.status).toBe('AVAILABLE');
  });
});

describe('indicators', () => {
  const view = { usable: true, health: 'AVAILABLE' as const, cooldownUntil: undefined };
  it('🟢 / 🟡 / 🟠 / 🔴 / ⚫ from real data only', () => {
    const u = modelUsage([...Array.from({ length: 180 }, (_, i) => rec('a', 30 + i))], NOW).a;
    expect(modelIndicator(view, undefined, u, {}, NOW).label).toBe('Healthy'); // no known limit → never a percentage
    expect(modelIndicator(view, undefined, u, { rpd: 250 }, NOW).label).toBe('High usage');
    expect(modelIndicator(view, undefined, u, { rpd: 190 }, NOW).label).toBe('Near limit');
    expect(modelIndicator(view, { status: 'RATE_LIMITED', cooldownUntil: NOW + 42_000, learned: {} }, u, {}, NOW).label).toBe('Rate limited');
    expect(modelIndicator({ ...view, usable: false }, undefined, u, {}, NOW).label).toBe('Unavailable');
    expect(modelPressure('a', u, { rpd: 250, rpm: 'unlimited' })).toMatchObject({ key: 'rpd', used: 180, pct: 72, remaining: 70 });
  });

  it('Unknown is never shown as Unlimited', () => {
    expect(formatLimit(undefined)).toBe('Unknown');
    expect(formatLimit('unlimited')).toBe('Unlimited');
    expect(formatLimit(1000)).toBe((1000).toLocaleString());
  });

  it('Coach badge: AI Ready unless every usable model is cooling down', () => {
    const models = [{ id: 'a', usable: true }, { id: 'b', usable: true }];
    const stats = applyAttempts(EMPTY_STATS, [{ model: 'a', outcome: 'rate_limited', latencyMs: 1, cooldownUntil: NOW + 60_000 }], {}, NOW);
    expect(routerBadge({ connected: true, quota: false, models, stats, perModel: {}, usage, now: NOW }).label).toBe('AI Ready');
    const both = applyAttempts(stats, [{ model: 'b', outcome: 'quota_exhausted', latencyMs: 1, cooldownUntil: NOW + 60_000 }], {}, NOW);
    expect(routerBadge({ connected: true, quota: false, models, stats: both, perModel: {}, usage, now: NOW }).label).toBe('Limit reached');
    expect(routerBadge({ connected: false, quota: false, stats: EMPTY_STATS, perModel: {}, usage, now: NOW }).label).toBe('Basic coach');
  });
});
