import { CAPABILITIES, type Capabilities, type FreeTierStatus, type ModelTier } from '../../src/ai/shared/models.js';

/**
 * GeminiModelRegistry: which models exist for this API key (discovered with
 * models.list), what they can do, and whether they are verified Free Tier.
 *
 * The Gemini API returns names, versions, token limits and supported methods, but
 * NOT image/tool/JSON capabilities, rate limits or pricing. So:
 * - capabilities come from the model family (documented per family); an unfamiliar
 *   naming pattern → capabilities unknown → never routed to automatically;
 * - Free Tier status comes from a short documented list plus GEMINI_FREE_MODELS
 *   (server env) — anything else is "unknown" and is never used in FREE TIER ONLY mode;
 * - rate limits are never hard-coded: they are learned from Google's 429 details or
 *   entered by the player from AI Studio.
 */

export interface RawModel {
  name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedActions?: string[];
  supportedGenerationMethods?: string[];
}

export interface RegistryModel {
  id: string;
  displayName: string;
  version?: string;
  tier: ModelTier;
  /** Numeric family version (2.5, 3, 3.1…) used to prefer newer models of the same tier. */
  familyVersion: number;
  preview: boolean;
  alias: boolean;
  capabilities: Capabilities;
  capabilitiesKnown: boolean;
  freeTier: FreeTierStatus;
  freeTierSource: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  /** Set when the model must never be routed to (deprecated, generation-only, no generateContent…). */
  excluded?: string;
}

const none = (): Capabilities => Object.fromEntries(CAPABILITIES.map((c) => [c, null])) as Capabilities;

/** Documented capabilities of the multimodal Gemini chat families (Flash-Lite, Flash, Pro). */
const GEMINI_CHAT: Capabilities = {
  text: true,
  imageInput: true,
  audioInput: true,
  videoInput: true,
  functionCalling: true,
  structuredOutput: true,
  systemInstruction: true,
  live: false,
  streaming: true,
};

/** Gemma open models on the Gemini API: text (+ image for Gemma 3), no tools, no JSON schema, no system instruction. */
const GEMMA: Capabilities = {
  text: true,
  imageInput: null,
  audioInput: null,
  videoInput: false,
  functionCalling: false,
  structuredOutput: false,
  systemInstruction: false,
  live: false,
  streaming: true,
};

/**
 * Models documented as available on the Gemini API Free Tier (public docs and
 * reports, 2026). Deliberately short: when in doubt a model stays "unknown".
 * Extend without code changes with GEMINI_FREE_MODELS=model-a,model-b.
 */
export const DOCUMENTED_FREE = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'];
const DOCUMENTED_FREE_PATTERNS = [/^gemma-3(n)?-/];
/** Families documented as paid-only on the Gemini API. */
const DOCUMENTED_PAID = [/^gemini-3(\.\d+)?-pro/, /image/, /^imagen-/, /^veo-/, /-tts/];

/** Generation-only or special-purpose models: never used for chat, food analysis or tools. */
const SPECIAL: [RegExp, string][] = [
  [/embedding|^aqa$|^text-/, 'Embeddings / retrieval model'],
  [/^imagen-|^veo-|image-generation|-image(-preview)?(-\d{2}-\d{2})?$|flash-image|pro-image/, 'Image/video generation model (not image understanding)'],
  [/-tts/, 'Text-to-speech model'],
  [/robotics|computer-use|learnlm|lyria/, 'Special-purpose model'],
];

const csv = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function freeTierOf(id: string): { status: FreeTierStatus; source: string } {
  if (csv(process.env.GEMINI_PAID_MODELS).includes(id)) return { status: 'paid', source: 'GEMINI_PAID_MODELS' };
  if (csv(process.env.GEMINI_FREE_MODELS).includes(id)) return { status: 'free', source: 'GEMINI_FREE_MODELS (verified by you)' };
  if (DOCUMENTED_FREE.includes(id) || DOCUMENTED_FREE_PATTERNS.some((p) => p.test(id))) return { status: 'free', source: 'Documented Free Tier model' };
  if (DOCUMENTED_PAID.some((p) => p.test(id))) return { status: 'paid', source: 'Documented as paid-only' };
  return { status: 'unknown', source: 'Not verified as Free Tier' };
}

const CHAT_SUFFIX = /^(|latest|\d{3}|preview(-\d{2}-\d{4}|-\d{2}-\d{2}|-\d{4})?)$/;

/** Capabilities from the model's family. Unknown naming patterns get unknown capabilities. */
export function getModelCapabilities(id: string): { tier: ModelTier; familyVersion: number; preview: boolean; alias: boolean; capabilities: Capabilities; known: boolean; excluded?: string } {
  for (const [re, why] of SPECIAL) if (re.test(id)) return { tier: 'other', familyVersion: 0, preview: false, alias: false, capabilities: none(), known: false, excluded: why };

  const alias = /^gemini-(flash-lite|flash|pro)-latest$/.exec(id);
  if (alias) return { tier: tierOf(alias[1]), familyVersion: 99, preview: false, alias: true, capabilities: { ...GEMINI_CHAT }, known: true };

  if (/live|native-audio/.test(id)) {
    const v = Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
    return { tier: 'live', familyVersion: v, preview: /preview|exp/.test(id), alias: false, capabilities: { ...none(), text: true, audioInput: true, live: true, streaming: true, functionCalling: true }, known: true };
  }

  const g = /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash-8b|flash|pro)(?:-(.+))?$/.exec(id);
  if (g) {
    const v = Number(g[1]);
    const suffix = g[3] ?? '';
    const tier = tierOf(g[2]);
    if (v < 1.5) return { tier, familyVersion: v, preview: false, alias: false, capabilities: none(), known: false, excluded: 'Retired model generation' };
    const known = CHAT_SUFFIX.test(suffix);
    return { tier, familyVersion: v, preview: /preview|exp/.test(suffix), alias: suffix === 'latest', capabilities: known ? { ...GEMINI_CHAT } : none(), known };
  }

  const gemma = /^gemma-(\d+)(n)?-/.exec(id);
  if (gemma) {
    const v = Number(gemma[1]);
    return { tier: 'open', familyVersion: v, preview: false, alias: false, capabilities: { ...GEMMA, imageInput: v >= 3 && !/-1b-/.test(id) ? true : null }, known: v >= 3 };
  }
  return { tier: 'other', familyVersion: 0, preview: /preview|exp/.test(id), alias: false, capabilities: none(), known: false };
}

function tierOf(name: string): ModelTier {
  return name === 'pro' ? 'pro' : name === 'flash' ? 'flash' : 'lite';
}

export function toRegistryModel(raw: RawModel): RegistryModel | undefined {
  const id = (raw.name ?? '').replace(/^models\//, '').trim();
  if (!id) return undefined;
  const caps = getModelCapabilities(id);
  const free = freeTierOf(id);
  const methods = raw.supportedActions ?? raw.supportedGenerationMethods;
  let excluded = caps.excluded;
  if (!excluded && methods && !methods.includes('generateContent') && caps.tier !== 'live') excluded = 'Does not support generateContent';
  if (!excluded && /deprecat|discontinu|shut ?down|retired/i.test(raw.description ?? '')) excluded = 'Deprecated by Google';
  return {
    id,
    displayName: raw.displayName || id,
    version: raw.version,
    tier: caps.tier,
    familyVersion: caps.familyVersion,
    preview: caps.preview,
    alias: caps.alias,
    capabilities: caps.capabilities,
    capabilitiesKnown: caps.known,
    freeTier: free.status,
    freeTierSource: free.source,
    inputTokenLimit: raw.inputTokenLimit,
    outputTokenLimit: raw.outputTokenLimit,
    excluded,
  };
}

// ——— Discovery (cached per serverless instance) ———

export interface ModelLister {
  list(params?: Record<string, unknown>): Promise<AsyncIterable<RawModel> | Iterable<RawModel>>;
}

interface Discovery {
  at: number;
  models: RegistryModel[];
  discovered: boolean;
}

const TTL_MS = 10 * 60_000;
let cache: Discovery | undefined;

export function clearDiscoveryCache(): void {
  cache = undefined;
}

/**
 * List the models this key can use. When listing fails for a non-auth reason, only
 * the configured model is known (marked as not discovered) so the app keeps working.
 */
export async function discoverModels(lister: ModelLister, opts: { refresh?: boolean; fallbackId: string; now?: number }): Promise<Discovery> {
  const now = opts.now ?? Date.now();
  if (!opts.refresh && cache && now - cache.at < TTL_MS) return cache;
  try {
    const out: RegistryModel[] = [];
    const pager = await lister.list({ config: { pageSize: 100 } });
    for await (const raw of pager as AsyncIterable<RawModel>) {
      const m = toRegistryModel(raw);
      if (m && !out.some((x) => x.id === m.id)) out.push(m);
      if (out.length >= 300) break;
    }
    cache = { at: now, models: out, discovered: true };
    return cache;
  } catch (e) {
    const status = (e as { status?: number }).status;
    const msg = String((e as Error)?.message ?? '').toLowerCase();
    if (status === 401 || status === 403 || msg.includes('api key not valid') || msg.includes('api_key_invalid')) throw e;
    const m = toRegistryModel({ name: opts.fallbackId });
    return { at: now, models: m ? [m] : [], discovered: false };
  }
}
