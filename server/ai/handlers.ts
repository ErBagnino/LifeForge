import { GoogleGenAI } from '@google/genai';
import { classifyCoachText } from '../../src/ai/shared/classify.js';
import { FoodEstimateSchema, FoodRequestSchema, sumFoods } from '../../src/ai/shared/food.js';
import { type ModelsResponse, type ModelView, type RequestType, ROUTES, type RoutingInfo, type RoutingPrefs, RoutingPrefsSchema } from '../../src/ai/shared/models.js';
import { ChatRequestSchema, TOOL_DEFS, cleanSchema, toolJsonSchema } from '../../src/ai/shared/tools.js';
import { z } from 'zod';
import { allowPaid, geminiKey, geminiModel, LIMITS } from './config.js';
import { AiFailure, classifyError, ERROR_MESSAGES, ERROR_STATUS, quotaDetail, type AiErrorKind } from './errors.js';
import { RouterError, runRouted, sanitizeSignatures } from './execute.js';
import { coachSystem, foodSystem, reviseInstruction } from './prompts.js';
import { discoverModels, type ModelLister, type RawModel, type RegistryModel } from './registry.js';
import { getHealth, routesFor, selectModels } from './router.js';

type GenerateResult = {
  text?: string;
  functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[];
  candidates?: { content?: { role?: string; parts?: unknown[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

/** The subset of the SDK the handlers use (injectable for tests). */
export interface GeminiClient {
  models: {
    generateContent(params: Record<string, unknown>): Promise<GenerateResult>;
    get?(params: { model: string }): Promise<{ name?: string; displayName?: string }>;
    list(params?: Record<string, unknown>): Promise<AsyncIterable<RawModel> | Iterable<RawModel>>;
  };
}

export type ClientFactory = (apiKey: string) => GeminiClient;
export const defaultFactory: ClientFactory = (apiKey) => new GoogleGenAI({ apiKey }) as unknown as GeminiClient;

/** Structured server logs: model, type, status, latency, tokens, error category. Never content, images or keys. */
let logger: (event: Record<string, unknown>) => void = (event) => console.info(JSON.stringify(event));
export function setLogger(fn: (event: Record<string, unknown>) => void): void {
  logger = fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function errorResponse(kind: AiErrorKind, message?: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: { kind, message: message ?? ERROR_MESSAGES[kind], ...extra } }, ERROR_STATUS[kind]);
}

function failure(e: unknown, context: 'chat' | 'food'): Response {
  if (e instanceof RouterError) {
    const kind: AiErrorKind = e.kind;
    const last = [...e.attempts].reverse().find((a) => a.quota);
    return errorResponse(kind, undefined, { routing: { attempts: e.attempts, retryAt: e.retryAt }, ...(last?.quota ? { quota: last.quota } : {}) });
  }
  const kind = classifyError(e, context);
  return errorResponse(kind, undefined, kind === 'quota' ? { quota: quotaDetail(e) } : {});
}

const usageOf = (u?: GenerateResult['usageMetadata']) =>
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

function clientFor(factory: ClientFactory): GeminiClient {
  const key = geminiKey();
  if (!key) throw new AiFailure('not_configured');
  return factory(key);
}

function prefsOf(raw: unknown): RoutingPrefs {
  const r = RoutingPrefsSchema.safeParse((raw as { routing?: unknown } | null)?.routing ?? {});
  return r.success ? r.data : { freeTierOnly: true };
}

// ——— Response dedupe (same requestId → same answer, no second Gemini call) ———

const recent = new Map<string, { at: number; body: unknown }>();
function remembered(id?: string): unknown {
  if (!id) return undefined;
  const hit = recent.get(id);
  return hit && Date.now() - hit.at < 120_000 ? hit.body : undefined;
}
function remember(id: string | undefined, body: unknown): void {
  if (!id) return;
  recent.set(id, { at: Date.now(), body });
  if (recent.size > 100) recent.delete(recent.keys().next().value!);
}

/** Discover models, select a chain for this request type, run it with fallback. */
async function routed<R>(
  client: GeminiClient,
  requestType: RequestType,
  prefs: RoutingPrefs,
  estimatedTokens: number,
  context: 'chat' | 'food' | 'status',
  call: (model: RegistryModel, variant: 'as-is' | 'strip' | 'skip') => Promise<R>,
): Promise<{ result: R; model: RegistryModel; routing: RoutingInfo }> {
  const disc = await discoverModels(client.models as ModelLister, { fallbackId: geminiModel() });
  const freeTierOnly = prefs.freeTierOnly !== false || !allowPaid();
  const selection = selectModels({
    requestType,
    models: disc.models,
    freeTierOnly,
    allowPaid: allowPaid(),
    preferred: process.env.GEMINI_MODEL?.trim() || undefined,
    sticky: prefs.lastModel,
    hints: prefs.hints,
    estimatedTokens,
    now: Date.now(),
  });
  return runRouted(selection, requestType, call, { freeTierOnly, allowPaid: allowPaid(), context, producedBy: prefs.lastModel, log: logger });
}

const FUNCTION_DECLARATIONS = TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, parametersJsonSchema: toolJsonSchema(d) }));

type Content = { role: 'user' | 'model'; parts: Record<string, unknown>[] };

/** Server-side request classification for the Coach. */
export function classifyChat(contents: Content[], intent?: RoutingPrefs['intent']): RequestType {
  const last = contents[contents.length - 1];
  if (last?.parts.some((p) => 'inlineData' in p)) return 'IMAGE_ANALYSIS';
  if (last?.parts.some((p) => 'functionResponse' in p)) return 'TOOL_EXECUTION';
  if (intent) return intent;
  const text = last?.parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join(' ') ?? '';
  return classifyCoachText(text);
}

/** POST /api/ai — one step of the Coach conversation (the app runs the tool loop). */
export async function handleChat(req: Request, factory: ClientFactory = defaultFactory): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('bad_request', 'Use POST.');
  try {
    const raw = await readJson(req, LIMITS.chatBodyBytes);
    const parsed = ChatRequestSchema.safeParse(raw);
    if (!parsed.success) return errorResponse('bad_request', 'Invalid chat payload.');
    const prefs = prefsOf(raw);
    const cached = remembered(prefs.requestId);
    if (cached) return json(cached);
    const client = clientFor(factory);
    const contents = parsed.data.contents as Content[];
    const requestType = classifyChat(contents, prefs.intent);
    const size = JSON.stringify(contents).length + parsed.data.context.length;
    const { result: res, model, routing } = await routed(client, requestType, prefs, Math.ceil(size / 4) + 1500, 'chat', (m, variant) =>
      client.models.generateContent({
        model: m.id,
        contents: variant === 'as-is' ? contents : sanitizeSignatures(contents, variant),
        config: {
          systemInstruction: `${coachSystem(parsed.data.personality)}\n\nCURRENT GAME CONTEXT (JSON):\n${parsed.data.context}`,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
          temperature: 0.4,
          maxOutputTokens: LIMITS.maxOutputTokensChat,
        },
      }),
    );
    const content = res.candidates?.[0]?.content;
    const calls = (res.functionCalls ?? []).filter((c) => c.name).map((c) => ({ id: c.id, name: c.name!, args: c.args ?? {} }));
    let text: string | undefined;
    try {
      text = res.text;
    } catch {
      text = undefined;
    }
    const body = { content: content ?? { role: 'model', parts: text ? [{ text }] : [] }, text: text ?? '', calls, model: model.id, usage: usageOf(res.usageMetadata), routing };
    remember(prefs.requestId, body);
    return json(body);
  } catch (e) {
    return failure(e, 'chat');
  }
}

const ESTIMATE_JSON_SCHEMA = cleanSchema(z.toJSONSchema(FoodEstimateSchema, { io: 'input' }));

/** POST /api/food — analyze a photo, revise an estimate, or explain it. Images are never stored or logged. */
export async function handleFood(req: Request, factory: ClientFactory = defaultFactory): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('bad_request', 'Use POST.');
  try {
    const raw = await readJson(req, LIMITS.foodBodyBytes);
    const parsed = FoodRequestSchema.safeParse(raw);
    if (!parsed.success) return errorResponse('bad_request', 'Invalid food payload.');
    const body = parsed.data;
    const prefs = prefsOf(raw);
    const cached = remembered(prefs.requestId);
    if (cached) return json(cached);
    const client = clientFor(factory);
    const lang = `Language for names and questions: ${body.locale || 'en'}.`;

    if (body.mode === 'explain') {
      const { result: res, model, routing } = await routed(client, 'FOOD_EXPLAIN', prefs, 1500, 'food', (m) =>
        client.models.generateContent({
          model: m.id,
          contents: [{ role: 'user', parts: [{ text: `Meal estimate (JSON): ${JSON.stringify(body.estimate)}\n\nQuestion: ${body.question}` }] }],
          config: { systemInstruction: `${foodSystem()}\nAnswer the question about this estimate in 2–4 short sentences: mention portion sizes, cooking method, oil/sauces and the assumptions. ${lang}`, temperature: 0.3, maxOutputTokens: 600 },
        }),
      );
      const out = { text: res.text ?? '', model: model.id, usage: usageOf(res.usageMetadata), routing };
      remember(prefs.requestId, out);
      return json(out);
    }

    const requestType: RequestType = body.mode === 'analyze' ? 'FOOD_IMAGE' : 'FOOD_REVISE';
    const parts: unknown[] =
      body.mode === 'analyze'
        ? [{ inlineData: { mimeType: body.image.mimeType, data: body.image.data } }, { text: `${body.note ? `User note: ${body.note}\n` : ''}Estimate this meal. ${lang}` }]
        : [{ text: `${reviseInstruction()}\n\nPrevious estimate (JSON): ${JSON.stringify(body.estimate)}\n\nUser: ${body.message}\n\n${lang}` }];

    const { result: res, model, routing } = await routed(client, requestType, prefs, body.mode === 'analyze' ? 2500 : 2000, 'food', (m) =>
      client.models.generateContent({
        model: m.id,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: foodSystem(),
          responseMimeType: 'application/json',
          responseJsonSchema: ESTIMATE_JSON_SCHEMA,
          temperature: 0.2,
          maxOutputTokens: LIMITS.maxOutputTokensFood,
        },
      }),
    );
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(res.text ?? '');
    } catch {
      return errorResponse('image', 'The estimate came back in an unexpected format. Try again or add the meal manually.', { usage: usageOf(res.usageMetadata), routing });
    }
    const estimate = FoodEstimateSchema.safeParse(parsedJson);
    if (!estimate.success) return errorResponse('image', 'The estimate came back in an unexpected format. Try again or add the meal manually.', { routing });
    // Totals are recomputed from the items; the model's own sum is not trusted.
    const out = { estimate: { ...estimate.data, mealTotals: sumFoods(estimate.data.foods) }, model: model.id, usage: usageOf(res.usageMetadata), routing };
    remember(prefs.requestId, out);
    return json(out);
  } catch (e) {
    return failure(e, 'food');
  }
}

function modelView(m: RegistryModel, freeTierOnly: boolean): ModelView {
  const h = getHealth(m.id);
  const routes = routesFor(m, freeTierOnly, allowPaid());
  const now = Date.now();
  const cooling = (h.cooldownUntil ?? 0) > now;
  const why = m.excluded ?? (!m.capabilitiesKnown ? 'Capabilities unknown — not used automatically' : m.freeTier !== 'free' && (freeTierOnly || !allowPaid()) ? 'This model cannot be verified as Free Tier.' : !routes.length ? 'Not suitable for LifeForge requests' : undefined);
  return {
    id: m.id,
    displayName: m.displayName,
    version: m.version,
    tier: m.tier,
    preview: m.preview,
    alias: m.alias,
    capabilities: m.capabilities,
    capabilitiesKnown: m.capabilitiesKnown,
    freeTier: h.notOnTier ? 'paid' : m.freeTier,
    freeTierSource: h.notOnTier ? 'Google reported no Free Tier quota on your project' : m.freeTierSource,
    inputTokenLimit: m.inputTokenLimit,
    outputTokenLimit: m.outputTokenLimit,
    learnedLimits: h.learned,
    routes,
    usable: routes.length > 0 && !why,
    excluded: why,
    health: cooling ? h.status : h.status === 'UNKNOWN' || h.status === 'AVAILABLE' ? h.status : 'AVAILABLE',
    cooldownUntil: cooling ? h.cooldownUntil : undefined,
    lastError: h.lastError,
  };
}

/** GET /api/models — discovered models, capabilities, Free Tier status, routes and health. `?refresh=1` re-lists. */
export async function handleModels(req: Request, factory: ClientFactory = defaultFactory): Promise<Response> {
  const url = new URL(req.url);
  const freeTierOnly = url.searchParams.get('freeTierOnly') !== '0' || !allowPaid();
  const base = { provider: 'gemini' as const, freeTierOnly, allowPaid: allowPaid(), preferred: geminiModel() };
  if (!geminiKey()) return json({ ...base, state: 'not_configured', discovered: false, models: [], routes: emptyRoutes(), message: ERROR_MESSAGES.not_configured } satisfies ModelsResponse);
  try {
    const client = clientFor(factory);
    const disc = await discoverModels(client.models as ModelLister, { refresh: url.searchParams.get('refresh') === '1', fallbackId: geminiModel() });
    const models = disc.models.map((m) => modelView(m, freeTierOnly)).sort((a, b) => Number(b.usable) - Number(a.usable) || a.id.localeCompare(b.id));
    const routes = emptyRoutes();
    for (const r of Object.keys(ROUTES) as RequestType[]) {
      routes[r] = selectModels({ requestType: r, models: disc.models, freeTierOnly, allowPaid: allowPaid(), preferred: process.env.GEMINI_MODEL?.trim() || undefined, now: Date.now() }).chain.map((m) => m.id);
    }
    return json({ ...base, state: 'connected', discovered: disc.discovered, discoveredAt: disc.at, models, routes } satisfies ModelsResponse);
  } catch (e) {
    const kind = classifyError(e, 'status');
    return json({ ...base, state: 'error', discovered: false, models: [], routes: emptyRoutes(), message: ERROR_MESSAGES[kind] } satisfies ModelsResponse);
  }
}

function emptyRoutes(): Record<RequestType, string[]> {
  return Object.fromEntries((Object.keys(ROUTES) as RequestType[]).map((r) => [r, []])) as unknown as Record<RequestType, string[]>;
}

/**
 * GET /api/status — is Gemini configured, which models can serve the app?
 * `?test=1` (the "Test connection" button) routes one tiny request through the router.
 */
export async function handleStatus(req: Request, factory: ClientFactory = defaultFactory): Promise<Response> {
  const model = geminiModel();
  if (!geminiKey()) return json({ state: 'not_configured', provider: 'gemini', model });
  const url = new URL(req.url);
  const freeTierOnly = url.searchParams.get('freeTierOnly') !== '0' || !allowPaid();
  try {
    const client = clientFor(factory);
    const disc = await discoverModels(client.models as ModelLister, { fallbackId: model });
    const views = disc.models.map((m) => modelView(m, freeTierOnly));
    const usable = views.filter((v) => v.usable);
    const router = {
      mode: freeTierOnly ? 'FREE_TIER_ONLY' : 'PAID_ALLOWED',
      discovered: disc.discovered,
      models: views.length,
      available: usable.length,
      healthy: usable.filter((v) => !v.cooldownUntil).length,
      rateLimited: usable.filter((v) => v.cooldownUntil && (v.health === 'RATE_LIMITED' || v.health === 'QUOTA_EXHAUSTED')).length,
      unavailable: views.length - usable.length,
    };
    const coach = selectModels({ requestType: 'TEXT_CHAT', models: disc.models, freeTierOnly, allowPaid: allowPaid(), preferred: process.env.GEMINI_MODEL?.trim() || undefined, now: Date.now() }).chain[0];
    if (!coach) return json({ state: usable.length ? 'no_model' : 'cost_blocked', provider: 'gemini', model, router, message: usable.length ? ERROR_MESSAGES.no_model : 'No discovered model can be verified as Free Tier for the Coach.' });
    let probe: GenerateResult | undefined;
    let routing: RoutingInfo | undefined;
    if (url.searchParams.get('test') === '1') {
      const r = await routed(client, 'STATUS', { freeTierOnly }, 50, 'status', (m) => client.models.generateContent({ model: m.id, contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], config: { maxOutputTokens: 64, temperature: 0 } }));
      probe = r.result;
      routing = r.routing;
    }
    // The Gemini API does not expose remaining quota: `quota` stays null (AI Studio → Usage is authoritative).
    return json({ state: 'connected', provider: 'gemini', model: routing?.model ?? coach.id, modelName: 'Gemini · Auto', resolvedModel: routing?.model ?? coach.id, tested: !!routing, usage: usageOf(probe?.usageMetadata), quota: null, router, routing });
  } catch (e) {
    if (e instanceof RouterError) {
      const kind: AiErrorKind = e.kind === 'invalid_key' ? 'invalid_key' : e.kind === 'quota' ? 'quota' : e.kind === 'cost_blocked' ? 'cost_blocked' : e.kind === 'no_model' ? 'no_model' : 'server';
      const q = [...e.attempts].reverse().find((a) => a.quota)?.quota;
      return json({ state: kind, provider: 'gemini', model, message: ERROR_MESSAGES[kind], routing: { attempts: e.attempts, retryAt: e.retryAt }, ...(q ? { quota: q } : {}) });
    }
    const kind = classifyError(e, 'status');
    return json({ state: kind, provider: 'gemini', model, message: ERROR_MESSAGES[kind], ...(kind === 'quota' ? { quota: quotaDetail(e) } : {}) });
  }
}
