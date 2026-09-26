import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyCoachText } from '../../../src/ai/shared/classify';
import { RouterError, runRouted, sanitizeSignatures } from '../execute';
import { clearDiscoveryCache, discoverModels, getModelCapabilities, toRegistryModel, type RegistryModel } from '../registry';
import { costGuard, getHealth, nextPacificMidnight, recordOutcome, resetHealth, selectModels, type SelectInput } from '../router';

const NOW = Date.UTC(2026, 8, 23, 17, 0, 0); // 10:00 in California
const reg = (name: string, extra: Record<string, unknown> = {}) => toRegistryModel({ name: `models/${name}`, supportedActions: ['generateContent', 'countTokens'], ...extra })!;
const MODELS: RegistryModel[] = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-pro-preview', 'gemma-3-27b-it', 'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-native-audio-preview-09-2025', 'text-embedding-004', 'gemini-9-ultra-exp'].map((n) => reg(n));
const input = (patch: Partial<SelectInput>): SelectInput => ({ requestType: 'TEXT_CHAT', models: MODELS, freeTierOnly: true, allowPaid: false, now: NOW, ...patch });
const ids = (s: { chain: RegistryModel[] }) => s.chain.map((m) => m.id);
const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const quota429 = (quotaId: string, retry?: number, value = 10) => err(429, `RESOURCE_EXHAUSTED {"quotaId":"${quotaId}","quotaValue":"${value}"${retry ? `,"retryDelay":"${retry}s"` : ''}}`);
const noSleep = async () => undefined;

beforeEach(() => {
  resetHealth();
  clearDiscoveryCache();
});
afterEach(() => {
  delete process.env.GEMINI_FREE_MODELS;
});

describe('model registry', () => {
  it('knows capabilities per family; unknown patterns stay unknown', () => {
    expect(getModelCapabilities('gemini-2.5-flash').capabilities).toMatchObject({ imageInput: true, functionCalling: true, structuredOutput: true, live: false });
    expect(getModelCapabilities('gemini-9-ultra-exp').known).toBe(false);
    expect(getModelCapabilities('gemini-2.5-flash-image').excluded).toMatch(/generation/);
    expect(getModelCapabilities('gemini-2.5-flash-preview-tts').excluded).toMatch(/speech/);
    expect(getModelCapabilities('gemma-3-27b-it').capabilities.functionCalling).toBe(false);
    expect(getModelCapabilities('gemini-2.5-flash-native-audio-preview-09-2025')).toMatchObject({ tier: 'live' });
  });

  it('Free Tier status: documented list, env override, unknown otherwise', () => {
    expect(reg('gemini-2.5-flash').freeTier).toBe('free');
    expect(reg('gemini-2.5-pro').freeTier).toBe('unknown');
    expect(reg('gemini-3-pro-preview').freeTier).toBe('paid');
    process.env.GEMINI_FREE_MODELS = 'gemini-2.5-pro';
    expect(reg('gemini-2.5-pro').freeTier).toBe('free');
  });

  it('marks deprecated models and models without generateContent', () => {
    expect(reg('gemini-2.0-flash', { description: 'Deprecated: will be shut down' }).excluded).toMatch(/Deprecated/);
    expect(reg('gemini-2.5-flash', { supportedActions: ['countTokens'] }).excluded).toMatch(/generateContent/);
  });

  it('discovers models from the API (cached), falls back to the configured model on listing errors', async () => {
    let calls = 0;
    const lister = { list: async () => (calls++, [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-flash-lite' }]) };
    const d = await discoverModels(lister, { fallbackId: 'gemini-flash-latest', now: NOW });
    expect(d.models.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    await discoverModels(lister, { fallbackId: 'x', now: NOW + 1000 });
    expect(calls).toBe(1);
    await discoverModels(lister, { fallbackId: 'x', refresh: true, now: NOW + 2000 });
    expect(calls).toBe(2);
    clearDiscoveryCache();
    const failing = await discoverModels({ list: async () => Promise.reject(err(500, 'boom')) }, { fallbackId: 'gemini-flash-latest', now: NOW });
    expect(failing).toMatchObject({ discovered: false });
    expect(failing.models.map((m) => m.id)).toEqual(['gemini-flash-latest']);
    await expect(discoverModels({ list: async () => Promise.reject(err(400, 'API key not valid')) }, { fallbackId: 'x', refresh: true, now: NOW })).rejects.toThrow(/API key/);
  });
});

describe('model selection', () => {
  it('scenario 1: picks the best compatible available model (fast one for quick chat)', () => {
    const s = selectModels(input({}));
    expect(ids(s)[0]).toBe('gemini-2.5-flash-lite');
    expect(ids(s)).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
    expect(s.reasons['gemini-2.5-flash-lite']).toBe('Best compatible available model');
  });

  it('planning prefers a more capable model; food vision needs image + JSON', () => {
    process.env.GEMINI_FREE_MODELS = 'gemini-2.5-pro';
    const models = MODELS.map((m) => (m.id === 'gemini-2.5-pro' ? reg('gemini-2.5-pro') : m));
    expect(ids(selectModels(input({ requestType: 'PLANNING', models })))[0]).toBe('gemini-2.5-pro');
    const food = selectModels(input({ requestType: 'FOOD_IMAGE' }));
    expect(ids(food)).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    expect(food.excluded.find((e) => e.id === 'gemma-3-27b-it')?.why).toMatch(/Not a|Missing/);
    expect(food.excluded.find((e) => e.id === 'gemini-2.5-flash-image')?.why).toMatch(/generation/);
  });

  it('never uses live/audio models for text and uses them only for realtime voice', () => {
    expect(ids(selectModels(input({ requestType: 'TEXT_CHAT' })))).not.toContain('gemini-2.5-flash-native-audio-preview-09-2025');
    const voice = selectModels(input({ requestType: 'VOICE', freeTierOnly: false, allowPaid: true }));
    expect(ids(voice)).toEqual(['gemini-2.5-flash-native-audio-preview-09-2025']);
  });

  it('scenario 3: a model without the needed capability is skipped', () => {
    const noImage = { ...reg('gemini-2.5-flash-lite'), capabilities: { ...reg('gemini-2.5-flash-lite').capabilities, imageInput: false } };
    const s = selectModels(input({ requestType: 'IMAGE_ANALYSIS', models: [noImage, reg('gemini-2.5-flash')] }));
    expect(ids(s)).toEqual(['gemini-2.5-flash']);
    expect(s.excluded[0].why).toMatch(/imageInput/);
  });

  it('scenario 5: paid or unverified models are never used in FREE TIER ONLY mode (even if preferred)', () => {
    const s = selectModels(input({ requestType: 'PLANNING', preferred: 'gemini-2.5-pro' }));
    expect(ids(s)).not.toContain('gemini-2.5-pro');
    expect(ids(s)).not.toContain('gemini-3-pro-preview');
    expect(s.excluded.find((e) => e.id === 'gemini-2.5-pro')?.why).toBe('This model cannot be verified as Free Tier.');
    // Turning FREE TIER ONLY off in the app is not enough without GEMINI_ALLOW_PAID on the server.
    expect(ids(selectModels(input({ requestType: 'PLANNING', freeTierOnly: false, allowPaid: false })))).not.toContain('gemini-2.5-pro');
    expect(ids(selectModels(input({ requestType: 'PLANNING', freeTierOnly: false, allowPaid: true })))[0]).toMatch(/pro/);
    expect(costGuard(reg('gemini-2.5-pro'), true, true)).toEqual({ ok: false, reason: 'This model cannot be verified as Free Tier.' });
    const onlyPaid = selectModels(input({ models: [reg('gemini-2.5-pro')] }));
    expect(onlyPaid).toMatchObject({ chain: [], blockedByCost: true });
  });

  it('scenario 7: RPM limit → cooldown and fallback, then back after the cooldown', () => {
    recordOutcome('gemini-2.5-flash-lite', { model: 'gemini-2.5-flash-lite', outcome: 'rate_limited', latencyMs: 1, quota: { limitType: 'rpm', retryAfterSec: 42 } }, NOW);
    const s = selectModels(input({}));
    expect(ids(s)[0]).toBe('gemini-2.5-flash');
    expect(s.reasons['gemini-2.5-flash']).toMatch(/cooling down.*switched to fallback/i);
    expect(ids(selectModels(input({ now: NOW + 43_000 })))[0]).toBe('gemini-2.5-flash-lite');
  });

  it('scenario 6: RPD reached → out of the pool until midnight Pacific; Google’s limit is learned', () => {
    const until = recordOutcome('gemini-2.5-flash-lite', { model: 'gemini-2.5-flash-lite', outcome: 'quota_exhausted', latencyMs: 1, quota: { limitType: 'rpd', quotaValue: 1000 } }, NOW)!;
    expect(until).toBe(nextPacificMidnight(NOW));
    expect(until - NOW).toBe(14 * 3_600_000); // 10:00 → midnight PT
    expect(getHealth('gemini-2.5-flash-lite')).toMatchObject({ status: 'QUOTA_EXHAUSTED', learned: { rpd: 1000 } });
    expect(ids(selectModels(input({ now: NOW + 3_600_000 })))).not.toContain('gemini-2.5-flash-lite');
    // The app's own estimate can also take a model out of today's pool.
    resetHealth();
    const s = selectModels(input({ hints: { 'gemini-2.5-flash-lite': { dayRequests: 20, limits: { rpd: 20 } } } }));
    expect(ids(s)).toEqual(['gemini-2.5-flash']);
  });

  it('scenario 8: TPM near/at limit → compatible alternative', () => {
    const s = selectModels(input({ estimatedTokens: 5000, hints: { 'gemini-2.5-flash-lite': { minuteTokens: 248_000, limits: { tpm: 250_000 } } } }));
    expect(ids(s)[0]).toBe('gemini-2.5-flash');
    expect(s.excluded.find((e) => e.id === 'gemini-2.5-flash-lite')?.why).toMatch(/TPM/);
    const near = selectModels(input({ hints: { 'gemini-2.5-flash-lite': { minuteRequests: 13, limits: { rpm: 15 } } } }));
    expect(ids(near)[0]).toBe('gemini-2.5-flash');
    expect(near.reasons['gemini-2.5-flash']).toMatch(/less-loaded/);
  });

  it('"unlimited" is not infinite: TPM and RPD still apply', () => {
    const s = selectModels(input({ hints: { 'gemini-2.5-flash-lite': { minuteRequests: 999, dayRequests: 50, limits: { rpm: 'unlimited', rpd: 50 } } } }));
    expect(ids(s)).toEqual(['gemini-2.5-flash']);
  });

  it('sticks with the model that started the turn when it is healthy', () => {
    const s = selectModels(input({ requestType: 'TOOL_EXECUTION', sticky: 'gemini-2.5-flash-lite' }));
    expect(ids(s)[0]).toBe('gemini-2.5-flash-lite');
  });

  it('a model Google says has no free quota (limit 0) is blocked for this project', () => {
    recordOutcome('gemini-2.5-flash', { model: 'gemini-2.5-flash', outcome: 'quota_exhausted', latencyMs: 1, quota: { limitType: 'rpd', quotaValue: 0 } }, NOW);
    expect(costGuard(reg('gemini-2.5-flash'), true, false).ok).toBe(false);
  });
});

describe('execution with fallback', () => {
  const sel = (requestType: SelectInput['requestType'] = 'TEXT_CHAT') => selectModels(input({ requestType }));
  const opts = { freeTierOnly: true, allowPaid: false, context: 'chat' as const, sleep: noSleep };

  it('scenario 2: primary returns 429 → fallback answers, primary cools down', async () => {
    const tried: string[] = [];
    const r = await runRouted(sel(), 'TEXT_CHAT', async (m) => {
      tried.push(m.id);
      if (m.id === 'gemini-2.5-flash-lite') throw quota429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', 30);
      return 'ok';
    }, opts);
    expect(tried).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
    expect(r.routing).toMatchObject({ model: 'gemini-2.5-flash', fallback: true });
    expect(r.routing.reason).toMatch(/switched to fallback/);
    expect(r.routing.attempts[0]).toMatchObject({ outcome: 'rate_limited', quota: { limitType: 'rpm', retryAfterSec: 30 } });
    expect(getHealth('gemini-2.5-flash-lite').status).toBe('RATE_LIMITED');
  });

  it('transient errors retry with exponential backoff (max 2), then fall back', async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await runRouted(sel(), 'TEXT_CHAT', async (m) => {
      if (m.id === 'gemini-2.5-flash-lite') {
        n++;
        throw err(503, 'overloaded');
      }
      return 'ok';
    }, { ...opts, sleep: async (ms) => void waits.push(ms) });
    expect(n).toBe(3);
    expect(waits).toEqual([400, 800]);
    expect(r.model.id).toBe('gemini-2.5-flash');
  });

  it('invalid key or a malformed request stops immediately (no pointless fallback)', async () => {
    let n = 0;
    await expect(runRouted(sel(), 'TEXT_CHAT', async () => (n++, Promise.reject(err(400, 'API key not valid'))), opts)).rejects.toMatchObject({ kind: 'invalid_key' });
    expect(n).toBe(1);
  });

  it('a deprecated/removed model (404) is marked unavailable and skipped', async () => {
    const r = await runRouted(sel(), 'TEXT_CHAT', async (m) => (m.id === 'gemini-2.5-flash-lite' ? Promise.reject(err(404, 'models/x is not found')) : 'ok'), opts);
    expect(r.model.id).toBe('gemini-2.5-flash');
    expect(getHealth('gemini-2.5-flash-lite').status).toBe('UNSUPPORTED');
    expect(ids(sel())).toEqual(['gemini-2.5-flash']);
  });

  it('scenario 4: every model fails → no_model / quota error with the earliest retry time', async () => {
    const e = await runRouted(sel(), 'TEXT_CHAT', async () => Promise.reject(quota429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', 20)), opts).catch((x) => x);
    expect(e).toBeInstanceOf(RouterError);
    expect(e.kind).toBe('quota');
    expect(e.attempts).toHaveLength(2);
    expect(e.retryAt).toBeGreaterThan(Date.now());
    await expect(runRouted({ chain: [], reasons: {}, excluded: [], blockedByCost: false }, 'TEXT_CHAT', async () => 'x', opts)).rejects.toMatchObject({ kind: 'no_model' });
    await expect(runRouted({ chain: [], reasons: {}, excluded: [], blockedByCost: true }, 'TEXT_CHAT', async () => 'x', opts)).rejects.toMatchObject({ kind: 'cost_blocked' });
  });

  it('switching model mid-turn strips foreign thought signatures (and retries with the skip value if needed)', async () => {
    const contents = [{ role: 'model', parts: [{ functionCall: { name: 'getToday', args: {} }, thoughtSignature: 'abc' }] }];
    expect(sanitizeSignatures(contents, 'strip')[0].parts[0]).not.toHaveProperty('thoughtSignature');
    expect(sanitizeSignatures(contents, 'skip')[0].parts[0]).toHaveProperty('thoughtSignature', 'skip_thought_signature_validator');
    const variants: string[] = [];
    const r = await runRouted(sel('TOOL_EXECUTION'), 'TOOL_EXECUTION', async (m, v) => {
      variants.push(`${m.id}:${v}`);
      if (v === 'strip') throw err(400, 'Function call is missing a thought_signature');
      return 'ok';
    }, { ...opts, producedBy: 'gemini-3-flash-preview' });
    expect(variants).toEqual(['gemini-2.5-flash:strip', 'gemini-2.5-flash:skip']);
    expect(r.model.id).toBe('gemini-2.5-flash');
  });

  it('the cost guard is re-checked right before each call', async () => {
    const tried: string[] = [];
    const chain = [reg('gemini-2.5-pro'), reg('gemini-2.5-flash')]; // a forged chain containing an unverified model
    const r = await runRouted({ chain, reasons: {}, excluded: [], blockedByCost: false }, 'TEXT_CHAT', async (m) => (tried.push(m.id), 'ok'), opts);
    expect(tried).toEqual(['gemini-2.5-flash']);
    expect(r.routing.attempts[0]).toMatchObject({ model: 'gemini-2.5-pro', outcome: 'blocked' });
  });
});

describe('request classification', () => {
  it('quick questions vs planning vs analysis vs commands', () => {
    expect(classifyCoachText('Che cosa devo fare oggi?')).toBe('TEXT_CHAT');
    expect(classifyCoachText('Organizzami tutta la settimana')).toBe('PLANNING');
    expect(classifyCoachText('Analizza il mio andamento')).toBe('DATA_ANALYSIS');
    expect(classifyCoachText('Modifica il workout in base ai miei risultati')).toBe('DATA_ANALYSIS');
    expect(classifyCoachText('Imposta acqua 2 litri')).toBe('SIMPLE_COMMAND');
  });
});
