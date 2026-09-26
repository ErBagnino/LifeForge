import { GoogleGenAI } from '@google/genai';
import { FoodEstimateSchema, FoodRequestSchema, sumFoods } from '../../src/ai/shared/food.js';
import { ChatRequestSchema, TOOL_DEFS, cleanSchema, toolJsonSchema } from '../../src/ai/shared/tools.js';
import { z } from 'zod';
import { geminiKey, geminiModel, LIMITS } from './config.js';
import { AiFailure, classifyError, ERROR_MESSAGES, ERROR_STATUS, quotaDetail, type AiErrorKind } from './errors.js';
import { coachSystem, foodSystem, reviseInstruction } from './prompts.js';

/** The subset of the SDK the handlers use (injectable for tests). */
export interface GeminiClient {
  models: {
    generateContent(params: Record<string, unknown>): Promise<{
      text?: string;
      functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[];
      candidates?: { content?: { role?: string; parts?: unknown[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    }>;
    get(params: { model: string }): Promise<{ name?: string; displayName?: string }>;
  };
}

export type ClientFactory = (apiKey: string) => GeminiClient;
export const defaultFactory: ClientFactory = (apiKey) => new GoogleGenAI({ apiKey }) as unknown as GeminiClient;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function errorResponse(kind: AiErrorKind, message?: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: { kind, message: message ?? ERROR_MESSAGES[kind], ...extra } }, ERROR_STATUS[kind]);
}

/** Map a thrown error to a response; quota errors carry Google's own limit details. */
function failure(e: unknown, context: 'chat' | 'food'): Response {
  const kind = classifyError(e, context);
  return errorResponse(kind, undefined, kind === 'quota' ? { quota: quotaDetail(e) } : {});
}

const usageOf = (u?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }) =>
  u ? { inputTokens: u.promptTokenCount ?? null, outputTokens: u.candidatesTokenCount ?? null, totalTokens: u.totalTokenCount ?? null } : null;

async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new AiFailure('bad_request', 'Request too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new AiFailure('bad_request', 'Request too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new AiFailure('bad_request', 'Invalid JSON.');
  }
}

function withClient(factory: ClientFactory): { client: GeminiClient; model: string } {
  const key = geminiKey();
  if (!key) throw new AiFailure('not_configured');
  return { client: factory(key), model: geminiModel() };
}

const FUNCTION_DECLARATIONS = TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, parametersJsonSchema: toolJsonSchema(d) }));

/** POST /api/ai — one step of the Coach conversation (the app runs the tool loop). */
export async function handleChat(req: Request, factory: ClientFactory = defaultFactory): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('bad_request', 'Use POST.');
  try {
    const parsed = ChatRequestSchema.safeParse(await readJson(req, LIMITS.chatBodyBytes));
    if (!parsed.success) return errorResponse('bad_request', 'Invalid chat payload.');
    const { client, model } = withClient(factory);
    const res = await client.models.generateContent({
      model,
      contents: parsed.data.contents,
      config: {
        systemInstruction: `${coachSystem(parsed.data.personality)}\n\nCURRENT GAME CONTEXT (JSON):\n${parsed.data.context}`,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        temperature: 0.4,
        maxOutputTokens: LIMITS.maxOutputTokensChat,
      },
    });
    const content = res.candidates?.[0]?.content;
    const calls = (res.functionCalls ?? []).filter((c) => c.name).map((c) => ({ id: c.id, name: c.name!, args: c.args ?? {} }));
    let text: string | undefined;
    try {
      text = res.text;
    } catch {
      text = undefined;
    }
    return json({ content: content ?? { role: 'model', parts: text ? [{ text }] : [] }, text: text ?? '', calls, model, usage: usageOf(res.usageMetadata) });
  } catch (e) {
    return failure(e, 'chat');
  }
}

const ESTIMATE_JSON_SCHEMA = cleanSchema(z.toJSONSchema(FoodEstimateSchema, { io: 'input' }));

/** POST /api/food — analyze a photo, revise an estimate, or explain it. Images are never stored. */
export async function handleFood(req: Request, factory: ClientFactory = defaultFactory): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('bad_request', 'Use POST.');
  try {
    const parsed = FoodRequestSchema.safeParse(await readJson(req, LIMITS.foodBodyBytes));
    if (!parsed.success) return errorResponse('bad_request', 'Invalid food payload.');
    const body = parsed.data;
    const { client, model } = withClient(factory);
    const lang = `Language for names and questions: ${body.locale || 'en'}.`;

    if (body.mode === 'explain') {
      const res = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: `Meal estimate (JSON): ${JSON.stringify(body.estimate)}\n\nQuestion: ${body.question}` }] }],
        config: { systemInstruction: `${foodSystem()}\nAnswer the question about this estimate in 2–4 short sentences: mention portion sizes, cooking method, oil/sauces and the assumptions. ${lang}`, temperature: 0.3, maxOutputTokens: 600 },
      });
      return json({ text: res.text ?? '', model, usage: usageOf(res.usageMetadata) });
    }

    const parts: unknown[] =
      body.mode === 'analyze'
        ? [{ inlineData: { mimeType: body.image.mimeType, data: body.image.data } }, { text: `${body.note ? `User note: ${body.note}\n` : ''}Estimate this meal. ${lang}` }]
        : [{ text: `${reviseInstruction()}\n\nPrevious estimate (JSON): ${JSON.stringify(body.estimate)}\n\nUser: ${body.message}\n\n${lang}` }];

    const res = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: foodSystem(),
        responseMimeType: 'application/json',
        responseJsonSchema: ESTIMATE_JSON_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: LIMITS.maxOutputTokensFood,
      },
    });
    let raw: unknown;
    try {
      raw = JSON.parse(res.text ?? '');
    } catch {
      return errorResponse('image', 'The estimate came back in an unexpected format. Try again or add the meal manually.', { usage: usageOf(res.usageMetadata) });
    }
    const estimate = FoodEstimateSchema.safeParse(raw);
    if (!estimate.success) return errorResponse('image', 'The estimate came back in an unexpected format. Try again or add the meal manually.');
    // Totals are recomputed from the items; the model's own sum is not trusted.
    return json({ estimate: { ...estimate.data, mealTotals: sumFoods(estimate.data.foods) }, model, usage: usageOf(res.usageMetadata) });
  } catch (e) {
    return failure(e, 'food');
  }
}

/**
 * GET /api/status — is Gemini configured, and does the model answer?
 * `?test=1` (the "Test connection" button) makes one tiny request so quota and key
 * problems show up; without it only the model metadata is fetched.
 */
export async function handleStatus(req: Request, factory: ClientFactory = defaultFactory): Promise<Response> {
  const model = geminiModel();
  if (!geminiKey()) return json({ state: 'not_configured', provider: 'gemini', model });
  try {
    const { client } = withClient(factory);
    const info = await client.models.get({ model });
    const test = new URL(req.url).searchParams.get('test') === '1';
    const probe = test ? await client.models.generateContent({ model, contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], config: { maxOutputTokens: 64, temperature: 0 } }) : undefined;
    // The Gemini API does not expose remaining quota to the app: `quota` stays null
    // (Google AI Studio → Usage is the authoritative source).
    return json({ state: 'connected', provider: 'gemini', model, modelName: info.displayName ?? info.name ?? model, resolvedModel: info.name ?? model, tested: test, usage: usageOf(probe?.usageMetadata), quota: null });
  } catch (e) {
    const kind = classifyError(e, 'status');
    return json({ state: kind, provider: 'gemini', model, message: ERROR_MESSAGES[kind], ...(kind === 'quota' ? { quota: quotaDetail(e) } : {}) });
  }
}
