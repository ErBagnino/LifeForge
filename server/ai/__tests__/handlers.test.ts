import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleChat, handleFood, handleStatus, type GeminiClient } from '../handlers';
import { classifyError } from '../errors';
import { TOOL_DEFS, toolJsonSchema } from '../../../src/ai/shared/tools';

const chatBody = { contents: [{ role: 'user', parts: [{ text: 'Porta le proteine a 150g' }] }], context: '{"today":"2026-09-23"}', personality: 'direct' };
const post = (url: string, body: unknown) => new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function fakeClient(impl: Partial<GeminiClient['models']>): { factory: () => GeminiClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const client: GeminiClient = {
    models: {
      generateContent: async (p) => {
        calls.push(p);
        return impl.generateContent ? impl.generateContent(p) : { text: 'ok' };
      },
      get: impl.get ?? (async () => ({ name: 'models/gemini-test', displayName: 'Gemini Test' })),
    },
  };
  return { factory: () => client, calls };
}

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('serverless AI API', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('reports "not configured" without a key and never calls Gemini', async () => {
    delete process.env.GEMINI_API_KEY;
    const { factory, calls } = fakeClient({});
    const s = await (await handleStatus(new Request('http://x/api/status'), factory)).json();
    expect(s).toMatchObject({ state: 'not_configured', model: 'gemini-flash-latest' });
    const r = await handleChat(post('/api/ai', chatBody), factory);
    expect(r.status).toBe(503);
    expect((await r.json()).error.kind).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });

  it('uses GEMINI_MODEL, declares every tool and returns function calls', async () => {
    process.env.GEMINI_MODEL = 'gemini-custom';
    const { factory, calls } = fakeClient({
      generateContent: async () => ({
        functionCalls: [{ id: 'c1', name: 'updateNutritionTargets', args: { protein: 150 } }],
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'updateNutritionTargets', args: { protein: 150 } }, thoughtSignature: 'sig' }] } }],
      }),
    });
    const res = await (await handleChat(post('/api/ai', chatBody), factory)).json();
    expect(res.calls).toEqual([{ id: 'c1', name: 'updateNutritionTargets', args: { protein: 150 } }]);
    expect(res.content.parts[0].thoughtSignature).toBe('sig');
    const req = calls[0] as { model: string; config: { tools: { functionDeclarations: { name: string }[] }[]; systemInstruction: string } };
    expect(req.model).toBe('gemini-custom');
    expect(req.config.tools[0].functionDeclarations.map((f) => f.name)).toEqual(TOOL_DEFS.map((d) => d.name));
    expect(req.config.systemInstruction).toContain('2026-09-23');
  });

  it('maps Gemini errors to friendly kinds', async () => {
    const cases: [Error, string][] = [
      [apiError(429, 'RESOURCE_EXHAUSTED: quota exceeded'), 'quota'],
      [apiError(400, 'API key not valid. Please pass a valid API key.'), 'invalid_key'],
      [apiError(404, 'models/gemini-x is not found'), 'model'],
      [apiError(500, 'internal'), 'server'],
    ];
    for (const [err, kind] of cases) {
      const { factory } = fakeClient({ generateContent: async () => Promise.reject(err) });
      const r = await handleChat(post('/api/ai', chatBody), factory);
      expect((await r.json()).error.kind).toBe(kind);
    }
    expect(classifyError(apiError(400, 'Unable to process input image'), 'food')).toBe('image');
    const { factory } = fakeClient({ get: async () => Promise.reject(apiError(429, 'quota')) });
    expect((await (await handleStatus(new Request('http://x/api/status?test=1'), factory)).json()).state).toBe('quota');
  });

  it('rejects invalid and oversized payloads', async () => {
    const { factory } = fakeClient({});
    expect((await handleChat(post('/api/ai', { contents: [] }), factory)).status).toBe(400);
    const big = { ...chatBody, context: 'x'.repeat(3_100_000) };
    expect((await handleChat(post('/api/ai', big), factory)).status).toBe(400);
    expect((await handleFood(post('/api/food', { mode: 'analyze', image: { mimeType: 'image/gif', data: 'x'.repeat(200) } }), factory)).status).toBe(400);
  });

  it('food analysis returns a validated estimate with totals recomputed from the items', async () => {
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
    expect(r.estimate.questions[0].options).toContain('1 tbsp');
    const req = calls[0] as { config: { responseMimeType: string; responseJsonSchema: object }; contents: { parts: { inlineData?: unknown }[] }[] };
    expect(req.config.responseMimeType).toBe('application/json');
    expect(req.config.responseJsonSchema).toBeTruthy();
    expect(req.contents[0].parts[0].inlineData).toBeTruthy();

    const bad = fakeClient({ generateContent: async () => ({ text: 'not json' }) });
    const e = await handleFood(post('/api/food', { mode: 'revise', estimate: { ...estimate, mealTotals: { calories: 1, protein: 1, carbs: 1, fat: 1 } }, message: 'Era tacchino' }), bad.factory);
    expect((await e.json()).error.kind).toBe('image');
  });

  it('every tool has a clean JSON schema for Gemini', () => {
    for (const d of TOOL_DEFS) {
      const s = toolJsonSchema(d);
      expect(s.type).toBe('object');
      expect(JSON.stringify(s)).not.toContain('$schema');
    }
  });
});
