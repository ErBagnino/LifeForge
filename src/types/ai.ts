import type { ID, Timestamp } from './common';

export type AiRequestType = 'chat' | 'food_analyze' | 'food_revise' | 'food_explain' | 'status_test';

/**
 * One Gemini request made through LifeForge. Metadata only: no prompt, message,
 * image or reply text is ever stored here.
 */
export interface AiUsageRecord {
  id: ID;
  ts: Timestamp;
  model: string;
  type: AiRequestType;
  /** Token counts reported by Gemini (`usageMetadata`); undefined when not reported. */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  ok: boolean;
  /** HTTP status of the app's /api call (0 = network error / offline). */
  status: number;
  errorKind?: string;
  latencyMs: number;
  image: boolean;
  /** Router request type (TEXT_CHAT, FOOD_IMAGE…) and whether this attempt was a fallback. */
  requestType?: string;
  fallback?: boolean;
  /** Google's own details for a quota error (authoritative when present). */
  quota?: { limitType?: 'rpm' | 'tpm' | 'rpd' | 'tpd' | 'other'; quotaValue?: number; retryAfterSec?: number };
}

/** Snapshot of one record before a Coach change (restored by Undo). */
export interface ChangeSnapshot {
  table: string;
  key: string;
  /** undefined = the record did not exist (undo deletes it). */
  before?: unknown;
}

export interface AiChange {
  id: ID;
  ts: Timestamp;
  tool: string;
  summary: string;
  source: 'gemini' | 'rules' | 'user';
  undo?: { kind: 'snapshot'; entries: ChangeSnapshot[] } | { kind: 'uncomplete'; questId: ID } | { kind: 'unskip'; questId: ID; before: unknown } | { kind: 'meal'; mealId: ID } | { kind: 'metric'; metricId: ID };
  undoneAt?: Timestamp;
}
