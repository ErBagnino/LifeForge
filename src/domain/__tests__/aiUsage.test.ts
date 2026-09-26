import { describe, expect, it } from 'vitest';
import type { AiUsageRecord, AiUsageSettings } from '@/types';
import { levelFor, summarizeUsage, usageBadge } from '../aiUsage';

const NOW = new Date('2026-09-23T15:00:00').getTime();
const base: AiUsageSettings = { tracking: true, limits: {}, thresholds: { notice: 70, warning: 85, critical: 95 } };
let id = 0;
const rec = (minsAgo: number, patch: Partial<AiUsageRecord> = {}): AiUsageRecord => ({ id: `u${++id}`, ts: NOW - minsAgo * 60_000, model: 'gemini-flash-latest', type: 'chat', inputTokens: 1000, outputTokens: 50, totalTokens: 1050, ok: true, status: 200, latencyMs: 900, image: false, ...patch });

describe('Gemini usage estimate', () => {
  it('counts requests and tokens per period without inventing a quota', () => {
    const s = summarizeUsage([rec(0.5), rec(10, { type: 'food_analyze', image: true }), rec(60 * 30)], base, NOW);
    expect(s.today.requests).toBe(2);
    expect(s.today.inputTokens).toBe(2000);
    expect(s.last24h.requests).toBe(2);
    expect(s.lastMinute.requests).toBe(1);
    expect(s.limits).toEqual([]); // no limits entered → no percentages
    expect(s.level).toBe('unknown');
    expect(usageBadge(s, true)).toMatchObject({ label: 'Gemini OK' });
  });

  it('percentages only against limits the player entered, with configurable thresholds', () => {
    const records = Array.from({ length: 18 }, (_, i) => rec(30 + i));
    const s = summarizeUsage(records, { ...base, limits: { rpd: 20 } }, NOW);
    expect(s.limits).toEqual([{ key: 'rpd', used: 18, limit: 20, pct: 90, remaining: 2, level: 'high' }]);
    expect(usageBadge(s, true).label).toBe('Approaching limit');
    expect(levelFor(69, base.thresholds)).toBe('low');
    expect(levelFor(70, base.thresholds)).toBe('moderate');
    expect(levelFor(95, base.thresholds)).toBe('near');
    expect(levelFor(100, base.thresholds)).toBe('reached');
  });

  it('a Google quota error means "limit reached" until Google’s retry time or a later success', () => {
    const hit = rec(1, { ok: false, status: 429, errorKind: 'quota', inputTokens: undefined, outputTokens: undefined, totalTokens: undefined, quota: { limitType: 'rpm', retryAfterSec: 120 } });
    const s = summarizeUsage([rec(5), hit], base, NOW);
    expect(s.limitReached).toBe(true);
    expect(s.quotaHit).toMatchObject({ limitType: 'rpm', retryAfterSec: 120 });
    expect(usageBadge(s, true).label).toBe('Limit reached');
    expect(summarizeUsage([hit], base, NOW + 5 * 60_000).limitReached).toBe(false); // retry time passed
    expect(summarizeUsage([hit, rec(0)], base, NOW).limitReached).toBe(false); // later success
  });

  it('network errors and local validation errors do not count as Gemini requests', () => {
    const s = summarizeUsage([rec(1, { ok: false, status: 0, errorKind: 'offline' }), rec(2, { ok: false, status: 503, errorKind: 'not_configured' })], base, NOW);
    expect(s.today.requests).toBe(0);
  });

  it('daily rate and food share appear only with enough data (as estimates)', () => {
    const few = summarizeUsage([rec(1)], base, NOW);
    expect(few.perDay).toBeUndefined();
    expect(few.foodShare).toBeUndefined();
    const many = summarizeUsage([rec(1, { type: 'food_analyze', image: true }), rec(2), rec(60 * 24 + 5), rec(60 * 48 + 5), rec(60 * 48 + 6)], base, NOW);
    expect(many.perDay).toBeCloseTo(5 / 3, 1);
    expect(many.foodShare).toBe(20);
  });
});
