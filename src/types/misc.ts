import type { ID, Timestamp } from './common';
import type { NotificationType } from './settings';

export type SuggestionType =
  | 'exerciseProgression'
  | 'stepsTarget'
  | 'caloriesTarget'
  | 'proteinTarget'
  | 'cardioStage'
  | 'scheduleTime'
  | 'restDay';

export type SuggestionStatus = 'pending' | 'accepted' | 'declined';

/** A system recommendation that only takes effect after explicit user approval. */
export interface Suggestion {
  id: ID;
  /** Dedupe key: one pending suggestion per key. */
  key: string;
  type: SuggestionType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: SuggestionStatus;
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
}

export type NotificationStatus = 'scheduled' | 'sent' | 'suppressed' | 'failed';

export interface NotificationRecord {
  id: ID;
  type: NotificationType;
  title: string;
  body: string;
  /** Dedupe tag (e.g. `workout:2026-09-25`). */
  tag: string;
  scheduledAt: Timestamp;
  sentAt?: Timestamp;
  status: NotificationStatus;
  channel?: string;
  reason?: string;
}

export interface CounterEntry {
  key: string;
  value: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
