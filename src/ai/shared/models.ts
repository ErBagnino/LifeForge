import { z } from 'zod';

/**
 * Model-routing contract shared by the serverless router and the app.
 * Only zod + relative imports: this file is bundled into the server too.
 */

export const CAPABILITIES = ['text', 'imageInput', 'audioInput', 'videoInput', 'functionCalling', 'structuredOutput', 'systemInstruction', 'live', 'streaming'] as const;
export type Capability = (typeof CAPABILITIES)[number];
/** true / false, or null when nobody knows (unknown capabilities are never relied on). */
export type Capabilities = Record<Capability, boolean | null>;

/** Speed/capability class, used for route preferences (never a fixed list of names). */
export type ModelTier = 'lite' | 'flash' | 'pro' | 'open' | 'live' | 'other';

/**
 * Free Tier status:
 * - free: documented as available on the Gemini API Free Tier, or listed in GEMINI_FREE_MODELS
 * - paid: known to be paid-only (or Google reported a quota of 0 for this project)
 * - unknown: cannot be verified → never used automatically while FREE TIER ONLY is on
 */
export type FreeTierStatus = 'free' | 'paid' | 'unknown';

export const REQUEST_TYPES = ['TEXT_CHAT', 'SIMPLE_COMMAND', 'TOOL_EXECUTION', 'PLANNING', 'DATA_ANALYSIS', 'IMAGE_ANALYSIS', 'FOOD_IMAGE', 'FOOD_REVISE', 'FOOD_EXPLAIN', 'VOICE', 'STATUS'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export interface RouteSpec {
  /** Every capability listed must be true for a model to be eligible. */
  requires: Capability[];
  /** Tier preference, best first. Tiers not listed are not used for this route. */
  prefer: ModelTier[];
  label: string;
}

/**
 * Central routing table. Requirements are hard filters (fallback never drops a
 * capability); preferences only order the eligible models.
 */
export const ROUTES: Record<RequestType, RouteSpec> = {
  TEXT_CHAT: { requires: ['text', 'functionCalling', 'systemInstruction'], prefer: ['lite', 'flash', 'pro'], label: 'Coach · quick question' },
  SIMPLE_COMMAND: { requires: ['text', 'functionCalling', 'systemInstruction'], prefer: ['lite', 'flash', 'pro'], label: 'Coach · simple command' },
  TOOL_EXECUTION: { requires: ['text', 'functionCalling', 'systemInstruction'], prefer: ['flash', 'lite', 'pro'], label: 'Coach · tool results' },
  PLANNING: { requires: ['text', 'functionCalling', 'systemInstruction'], prefer: ['pro', 'flash', 'lite'], label: 'Coach · planning' },
  DATA_ANALYSIS: { requires: ['text', 'functionCalling', 'systemInstruction'], prefer: ['pro', 'flash', 'lite'], label: 'Coach · analysis' },
  IMAGE_ANALYSIS: { requires: ['text', 'imageInput', 'functionCalling', 'systemInstruction'], prefer: ['flash', 'pro', 'lite'], label: 'Coach · photo' },
  FOOD_IMAGE: { requires: ['text', 'imageInput', 'structuredOutput', 'systemInstruction'], prefer: ['flash', 'lite', 'pro'], label: 'Food Vision · photo' },
  FOOD_REVISE: { requires: ['text', 'structuredOutput', 'systemInstruction'], prefer: ['flash', 'lite', 'pro'], label: 'Food Vision · correction' },
  FOOD_EXPLAIN: { requires: ['text', 'systemInstruction'], prefer: ['lite', 'flash', 'pro'], label: 'Food Vision · explanation' },
  VOICE: { requires: ['live', 'audioInput'], prefer: ['live'], label: 'Realtime voice' },
  STATUS: { requires: ['text'], prefer: ['lite', 'flash', 'pro'], label: 'Connection test' },
};

export type HealthStatus = 'AVAILABLE' | 'BUSY' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED' | 'ERROR' | 'UNKNOWN' | 'UNSUPPORTED';

/** A limit value: a number, "unlimited" (still bounded by the other limits), or unknown (undefined). */
export type LimitValue = number | 'unlimited';
export interface ModelLimits {
  rpm?: LimitValue;
  tpm?: LimitValue;
  rpd?: LimitValue;
}

const Limit = z.union([z.number().int().positive().max(100_000_000), z.literal('unlimited')]);
const LimitsSchema = z.object({ rpm: Limit.optional(), tpm: Limit.optional(), rpd: Limit.optional() });

/**
 * What the app knows about each model from earlier requests (serverless instances
 * don't share memory, so the app sends it along). Only ever used to AVOID models —
 * it can never make an unverified model eligible.
 */
export const ModelHintSchema = z.object({
  cooldownUntil: z.number().int().nonnegative().optional(),
  status: z.enum(['AVAILABLE', 'BUSY', 'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'ERROR', 'UNKNOWN', 'UNSUPPORTED']).optional(),
  minuteRequests: z.number().int().min(0).max(100_000).optional(),
  minuteTokens: z.number().int().min(0).max(100_000_000).optional(),
  dayRequests: z.number().int().min(0).max(1_000_000).optional(),
  recentErrors: z.number().int().min(0).max(1000).optional(),
  limits: LimitsSchema.optional(),
});
export type ModelHint = z.infer<typeof ModelHintSchema>;

export const RoutingPrefsSchema = z.object({
  freeTierOnly: z.boolean().default(true),
  /** Model that produced the previous step of this turn (kept when healthy, for continuity). */
  lastModel: z.string().max(80).optional(),
  hints: z.record(z.string().max(80), ModelHintSchema).optional(),
  /** Idempotency / dedupe key of this request. */
  requestId: z.string().max(80).optional(),
  /** Coach only: the app's own classification of the user's message. */
  intent: z.enum(['TEXT_CHAT', 'SIMPLE_COMMAND', 'TOOL_EXECUTION', 'PLANNING', 'DATA_ANALYSIS']).optional(),
});
export type RoutingPrefs = z.infer<typeof RoutingPrefsSchema>;

export type AttemptOutcome = 'ok' | 'rate_limited' | 'quota_exhausted' | 'unavailable' | 'unsupported' | 'transient' | 'error' | 'blocked';

export interface RoutingAttempt {
  model: string;
  outcome: AttemptOutcome;
  status?: number;
  latencyMs: number;
  /** Google's quota details on a 429 (authoritative when present). */
  quota?: { limitType?: 'rpm' | 'tpm' | 'rpd' | 'tpd' | 'other'; quotaValue?: number; retryAfterSec?: number };
  cooldownUntil?: number;
}

/** Returned with every AI response. */
export interface RoutingInfo {
  requestType: RequestType;
  model: string;
  reason: string;
  /** True when the first choice failed and another model answered. */
  fallback: boolean;
  attempts: RoutingAttempt[];
  freeTierOnly: boolean;
}

/** One model as reported by GET /api/models. */
export interface ModelView {
  id: string;
  displayName: string;
  version?: string;
  tier: ModelTier;
  preview: boolean;
  alias: boolean;
  capabilities: Capabilities;
  capabilitiesKnown: boolean;
  freeTier: FreeTierStatus;
  freeTierSource: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  /** Limits Google reported in a 429 (the only authoritative source available to the app). */
  learnedLimits: ModelLimits;
  /** Routes this model may serve right now under the current cost mode. */
  routes: RequestType[];
  usable: boolean;
  /** Why it is not usable (unknown capabilities, not verified as Free Tier, deprecated…). */
  excluded?: string;
  health: HealthStatus;
  cooldownUntil?: number;
  lastError?: string;
}

export interface ModelsResponse {
  state: 'connected' | 'not_configured' | 'error';
  provider: 'gemini';
  discovered: boolean;
  discoveredAt?: number;
  freeTierOnly: boolean;
  allowPaid: boolean;
  preferred: string;
  models: ModelView[];
  routes: Record<RequestType, string[]>;
  message?: string;
}
