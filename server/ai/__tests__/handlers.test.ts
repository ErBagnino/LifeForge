import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleChat, handleFood, handleModels, handleStatus, setLogger, type GeminiClient } from '../handlers';
import { classifyError } from '../errors';
import { execConfig } from '../execute';
import { clearDiscoveryCache, type RawModel } from '../registry';
import { resetHealth } from '../router';
import { TOOL_DEFS, toolJsonSchema } from '../../../src/ai/shared/tools';

const chatBody = { contents: [{ role: 'user', parts: [{ text: 'Porta le proteine a 150g' }] }], context: '{"today":"2026-09-23"}', personality: 'direct' };
const post = (url: string, body: unknown) => new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const LISTED: RawModel[] = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash-image'].map((n) => ({ name: `models/${n}`, displayName: n, supportedActions: ['generateContent'] }));

/** Test double for the Google GenAI SDK (no network). */
function fakeClient(impl: { generateContent?: (p: Record<string, unknown>) => Promise<unknown>; models?: RawModel[] } = {}) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    models: {
      generateContent: async (p: Record<string, unknown>) => {
        calls.push(p);
        return impl.generateContent ? impl.generateContent(p) : { text: 'ok' };
      },
      list: async () => impl.models ?? LISTED,
    },
  } as unknown as GeminiClient;
  return { factory: () => client, calls };
}

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
const logs: Record<string, unknown>[] = [];

describe('serverless AI API', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_ALLOW_PAID;
    clearDiscoveryCache();
    resetHealth();
    logs.length = 0;
    setLogger((e) => logs.push(e));
    execConfig.sleep = async () => undefined;
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('reports "not configured" without a key and never calls Gemini', async () => {
    delete process.env.GEMINI_API_KEY;
    const { factory, calls } = fakeClient();
    const s = await (await handleStatus(new Request('http://x/api/status'), factory)).json();
    expect(s).toMatchObject({ state: 'not_configured', model: 'gemini-flash-latest' });
    const r = await handleChat(post('/api/ai', chatBody), factory);
    expect(r.status).toBe(503);
    expect((await r.json()).error.kind).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });

  it('routes the Coach to a Free Tier model, declares every tool and returns function calls + routing info', async () => {
    const { factory, calls } = fakeClient({
      generateContent: async () => ({
        functionCalls: [{ id: 'c1', name: 'updateNutritionTargets', args: { protein: 150 } }],
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'updateNutritionTargets', args: { protein: 150 } }, thoughtSignature: 'sig' }] } }],
      }),
    });
    const res = await (await handleChat(post('/api/ai', chatBody), factory)).json();
    expect(res.calls).toEqual([{ id: 'c1', name: 'updateNutritionTargets', args: { protein: 150 } }]);
    expect(res.content.parts[0].thoughtSignature).toBe('sig');
    expect(res.routing).toMatchObject({ requestType: 'SIMPLE_COMMAND', model: 'gemini-2.5-flash-lite', fallback: false, freeTierOnly: true });
    const req = calls[0] as { model: string; config: { tools: { functionDeclarations: { name: string }[] }[]; systemInstruction: string } };
    expect(req.model).toBe('gemini-2.5-flash-lite');
    expect(req.config.tools[0].functionDeclarations.map((f) => f.name)).toEqual(TOOL_DEFS.map((d) => d.name));
    expect(req.config.systemInstruction).toContain('2026-09-23');
    // Structured log: metadata only.
    expect(logs.at(-1)).toMatchObject({ evt: 'ai_request', model: 'gemini-2.5-flash-lite', status: 'ok' });
    expect(JSON.stringify(logs)).not.toContain('proteine');
    expect(JSON.stringify(logs)).not.toContain('test-key');
  });

  it('GEMINI_MODEL is the preferred first choice when it is a verified Free Tier model — never when it is not', async () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const a = fakeClient();
    await handleChat(post('/api/ai', chatBody), a.factory);
    expect((a.calls[0] as { model: string }).model).toBe('gemini-2.5-flash');
    process.env.GEMINI_MODEL = 'gemini-2.5-pro';
    const b = fakeClient();
    await handleChat(post('/api/ai', chatBody), b.factory);
    expect((b.calls[0] as { model: string }).model).not.toBe('gemini-2.5-pro');
  });

  it('429 on the primary → automatic fallback, same answer shape', async () => {
    const { factory } = fakeClient({
      generateContent: async (p) => (p.model === 'gemini-2.5-flash-lite' ? Promise.reject(apiError(429, 'RESOURCE_EXHAUSTED {"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","retryDelay":"30s"}')) : { text: 'Fatto.' }),
    });
    const res = await (await handleChat(post('/api/ai', chatBody), factory)).json();
    expect(res.text).toBe('Fatto.');
    expect(res.routing).toMatchObject({ model: 'gemini-2.5-flash', fallback: true });
    expect(res.routing.attempts[0]).toMatchObject({ model: 'gemini-2.5-flash-lite', outcome: 'rate_limited', quota: { limitType: 'rpm', retryAfterSec: 30 } });
  });

  it('maps errors to friendly kinds', async () => {
    const cases: [Error, string][] = [
      [apiError(429, 'RESOURCE_EXHAUSTED: quota exceeded'), 'quota'],
      [apiError(400, 'API key not valid. Please pass a valid API key.'), 'invalid_key'],
      [apiError(404, 'models/gemini-x is not found'), 'no_model'],
      [apiError(500, 'internal'), 'no_model'],
    ];
    for (const [err, kind] of cases) {
      clearDiscoveryCache();
      resetHealth();
      const { factory } = fakeClient({ generateContent: async () => Promise.reject(err) });
      const r = await handleChat(post('/api/ai', chatBody), factory);
      const body = await r.json();
      expect(body.error.kind).toBe(kind);
    }
    expect(classifyError(apiError(400, 'Unable to process input image'), 'food')).toBe('image');
  });

  it('no verified Free Tier model → cost_blocked, never a paid call', async () => {
    const { factory, calls } = fakeClient({ models: [{ name: 'models/gemini-2.5-pro', supportedActions: ['generateContent'] }] });
    const r = await handleChat(post('/api/ai', chatBody), factory);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatchObject({ kind: 'cost_blocked', message: 'This model cannot be verified as Free Tier.' });
    expect(calls).toHaveLength(0);
    // Turning FREE TIER ONLY off in the app alone doesn't enable paid models.
    const r2 = await handleChat(post('/api/ai', { ...chatBody, routing: { freeTierOnly: false } }), factory);
    expect(r2.status).toBe(403);
    process.env.GEMINI_ALLOW_PAID = 'true';
    const r3 = await handleChat(post('/api/ai', { ...chatBody, routing: { freeTierOnly: false } }), factory);
    expect(r3.status).toBe(200);
  });

  it('the same requestId returns the cached answer without a second Gemini call', async () => {
    const { factory, calls } = fakeClient();
    const body = { ...chatBody, routing: { freeTierOnly: true, requestId: 'req-1' } };
    await handleChat(post('/api/ai', body), factory);
    await handleChat(post('/api/ai', body), factory);
    expect(calls).toHaveLength(1);
  });

  it('rejects invalid and oversized payloads', async () => {
    const { factory } = fakeClient();
    expect((await handleChat(post('/api/ai', { contents: [] }), factory)).status).toBe(400);
    const big = { ...chatBody, context: 'x'.repeat(3_100_000) };
    expect((await handleChat(post('/api/ai', big), factory)).status).toBe(400);
    expect((await handleFood(post('/api/food', { mode: 'analyze', image: { mimeType: 'image/gif', data: 'x'.repeat(200) } }), factory)).status).toBe(400);
  });

  it('food analysis uses an image + JSON capable model and returns a validated estimate', async () => {
    const estimate = {
      isFood: true,
      mealName: 'Chicken & rice',
      foods: [
        { name: 'Chicken breast', estimatedQuantity: 180, unit: 'g', calories: 297, protein: 56, carbs: 0, fat: 6, confidence: 'high', cookingMethod: 'grilled' },
        { name: 'Rice', estimatedQuantity: 150, unit: 'g', calories: 195, protein: 4, carbs: 42, fat: 0, confidence: 'medium', cookingMethod: 'boiled' },
      ],
      mealTotals: { calories: 9999, protein: 1, carbs: 1, fat: 1 },
      overallConfidence: 'medium',
      assumptions: ['Cooked weights'],
      unknowns: ['Oil'],
      questions: [{ id: 'oil', text: 'How much oil did you use?', options: ['None', '1 tsp', '1 tbsp', '2 tbsp'] }],
    };
    const { factory, calls } = fakeClient({ generateContent: async () => ({ text: JSON.stringify(estimate) }) });
    const r = await (await handleFood(post('/api/food', { mode: 'analyze', image: { mimeType: 'image/jpeg', data: 'a'.repeat(500) }, locale: 'it' }), factory)).json();
    expect(r.estimate.mealTotals).toEqual({ calories: 492, protein: 60, carbs: 42, fat: 6 });
    expect(r.routing).toMatchObject({ requestType: 'FOOD_IMAGE', model: 'gemini-2.5-flash' });
    const req = calls[0] as { model: string; config: { responseMimeType: string; responseJsonSchema: object }; contents: { parts: { inlineData?: unknown }[] }[] };
    expect(req.model).not.toMatch(/image/); // never the image-GENERATION model
    expect(req.config.responseMimeType).toBe('application/json');
    expect(req.contents[0].parts[0].inlineData).toBeTruthy();
    expect(JSON.stringify(logs)).not.toContain('aaaa'); // images are never logged

    const bad = fakeClient({ generateContent: async () => ({ text: 'not json' }) });
    const e = await handleFood(post('/api/food', { mode: 'revise', estimate: { ...estimate, mealTotals: { calories: 1, protein: 1, carbs: 1, fat: 1 } }, message: 'Era tacchino' }), bad.factory);
    expect((await e.json()).error.kind).toBe('image');
  });

  it('food: the schema has no length/range limits, a rejected schema falls back to prompt-JSON, and the reply is normalised', async () => {
    const reply = { isFood: true, mealName: 'Pasta al pomodoro con basilico fresco e parmigiano grattugiato abbondante', foods: [{ name: 'Pasta', estimatedQuantity: '120', unit: 'grams', calories: 430, protein: 15, carbs: 86, fat: 2, confidence: 'HIGH', cookingMethod: 'al dente' }, { name: '', calories: 10 }], overallConfidence: 'medium', questions: [{ text: 'Olio?', options: ['No'] }] };
    const { factory, calls } = fakeClient({
      generateContent: async (p) => {
        if ((p.config as Record<string, unknown>).responseJsonSchema) throw apiError(400, '{"error":{"code":400,"message":"The specified schema produces a constraint that has too many states for serving.","status":"INVALID_ARGUMENT"}}');
        return { text: '```json\n' + JSON.stringify(reply) + '\n```' };
      },
    });
    const res = await handleFood(post('/api/food', { mode: 'analyze', image: { mimeType: 'image/jpeg', data: 'a'.repeat(500) } }), factory);
    const r = await res.json();
    expect(res.status).toBe(200);
    const first = calls[0] as { config: { responseJsonSchema: object } };
    expect(JSON.stringify(first.config.responseJsonSchema)).not.toMatch(/maxLength|minimum|maxItems/);
    const second = calls[1] as { model: string; config: { responseJsonSchema?: object; systemInstruction: string } };
    expect(second.model).toBe((calls[0] as { model: string }).model); // same model, no quota wasted elsewhere
    expect(second.config.responseJsonSchema).toBeUndefined();
    expect(second.config.systemInstruction).toMatch(/JSON Schema/);
    expect(r.estimate.foods).toHaveLength(1);
    expect(r.estimate.foods[0]).toMatchObject({ name: 'Pasta', estimatedQuantity: 120, unit: 'g', confidence: 'high', cookingMethod: 'unknown' });
    expect(r.estimate.mealName.length).toBeLessThanOrEqual(60);
    expect(r.estimate.questions).toEqual([]);
    expect(logs.some((l) => l.evt === 'ai_schema_fallback')).toBe(true);
  });

  it("a request Google rejects shows Google's own reason (keys scrubbed)", async () => {
    const { factory } = fakeClient({ generateContent: async () => { throw apiError(400, '{"error":{"code":400,"message":"Request contains an invalid argument. key=AIzaSyABCDEFGHIJKLMNOP","status":"INVALID_ARGUMENT"}}'); } });
    const res = await handleFood(post('/api/food', { mode: 'analyze', image: { mimeType: 'image/jpeg', data: 'a'.repeat(500) } }), factory);
    const r = await res.json();
    expect(res.status).toBe(400);
    expect(r.error.kind).toBe('bad_request');
    expect(r.error.message).toMatch(/Google said: “Request contains an invalid argument/);
    expect(r.error.message).not.toMatch(/AIza/);
  });

  it('GET /api/models lists discovered models with capabilities, Free Tier status, routes and health', async () => {
    const { factory } = fakeClient();
    const m = await (await handleModels(new Request('http://x/api/models'), factory)).json();
    expect(m).toMatchObject({ state: 'connected', discovered: true, freeTierOnly: true, allowPaid: false });
    const byId = Object.fromEntries(m.models.map((x: { id: string }) => [x.id, x]));
    expect(byId['gemini-2.5-flash']).toMatchObject({ usable: true, freeTier: 'free', health: 'UNKNOWN' });
    expect(byId['gemini-2.5-pro']).toMatchObject({ usable: false, excluded: 'This model cannot be verified as Free Tier.' });
    expect(byId['gemini-2.5-flash-image'].usable).toBe(false);
    expect(m.routes.FOOD_IMAGE).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    expect(m.routes.TEXT_CHAT[0]).toBe('gemini-2.5-flash-lite');
  });

  it('status test routes one tiny request and reports router counts', async () => {
    const { factory } = fakeClient();
    const s = await (await handleStatus(new Request('http://x/api/status?test=1'), factory)).json();
    expect(s).toMatchObject({ state: 'connected', modelName: 'Gemini · Auto', tested: true, router: { mode: 'FREE_TIER_ONLY', available: 2 } });
    const q = fakeClient({ generateContent: async () => Promise.reject(apiError(429, 'quota')) });
    clearDiscoveryCache();
    resetHealth();
    expect((await (await handleStatus(new Request('http://x/api/status?test=1'), q.factory)).json()).state).toBe('quota');
  });

  it('every tool has a clean JSON schema for Gemini', () => {
    for (const d of TOOL_DEFS) {
      const s = toolJsonSchema(d);
      expect(s.type).toBe('object');
      expect(JSON.stringify(s)).not.toContain('$schema');
    }
  });
});
