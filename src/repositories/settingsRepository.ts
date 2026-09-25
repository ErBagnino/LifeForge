import type { MetaEntry, Player, Settings, Suggestion, SuggestionStatus } from '@/types';
import { normalizeSettings, SETTINGS_SCHEMA_VERSION } from '@/data/defaultSettings';
import { getDb } from './db';

export interface SettingsRepository {
  get(): Promise<Settings | undefined>;
  save(settings: Settings): Promise<void>;
  /** Persist one-time settings migrations. Returns true when something was migrated. */
  migrate(): Promise<boolean>;
}

export const settingsRepository: SettingsRepository = {
  get: async () => {
    const s = await getDb().settings.get('settings');
    return s ? normalizeSettings(s) : undefined;
  },
  save: async (s) => {
    await getDb().settings.put({ ...s, updatedAt: Date.now() });
  },
  migrate: async () => {
    const raw = await getDb().settings.get('settings');
    if (!raw || (raw.schemaVersion ?? 1) >= SETTINGS_SCHEMA_VERSION) return false;
    await getDb().settings.put({ ...normalizeSettings(raw), updatedAt: Date.now() });
    return true;
  },
};

export interface PlayerRepository {
  get(): Promise<Player | undefined>;
  save(player: Player): Promise<void>;
}

export const playerRepository: PlayerRepository = {
  get: () => getDb().player.get('me'),
  save: async (p) => {
    await getDb().player.put({ ...p, updatedAt: Date.now() });
  },
};

export interface MetaRepository {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export const metaRepository: MetaRepository = {
  get: async <T>(key: string) => ((await getDb().meta.get(key)) as MetaEntry | undefined)?.value as T | undefined,
  set: async (key, value) => {
    await getDb().meta.put({ key, value });
  },
  remove: (key) => getDb().meta.delete(key),
};

export interface SuggestionRepository {
  pending(): Promise<Suggestion[]>;
  get(id: string): Promise<Suggestion | undefined>;
  /** Insert unless a pending suggestion with the same key exists. Returns true when inserted. */
  offer(s: Suggestion): Promise<boolean>;
  resolve(id: string, status: SuggestionStatus): Promise<Suggestion | undefined>;
  recent(limit: number): Promise<Suggestion[]>;
  wasDeclinedRecently(key: string, sinceTs: number): Promise<boolean>;
}

export const suggestionRepository: SuggestionRepository = {
  pending: () => getDb().suggestions.where('status').equals('pending').toArray(),
  get: (id) => getDb().suggestions.get(id),
  offer: async (s) => {
    const existing = await getDb().suggestions.where('key').equals(s.key).toArray();
    if (existing.some((e) => e.status === 'pending')) return false;
    await getDb().suggestions.put(s);
    return true;
  },
  resolve: async (id, status) => {
    const s = await getDb().suggestions.get(id);
    if (!s) return undefined;
    const next = { ...s, status, resolvedAt: Date.now() };
    await getDb().suggestions.put(next);
    return next;
  },
  recent: async (limit) => (await getDb().suggestions.toArray()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit),
  wasDeclinedRecently: async (key, sinceTs) =>
    (await getDb().suggestions.where('key').equals(key).toArray()).some(
      (s) => s.status === 'declined' && (s.resolvedAt ?? 0) >= sinceTs,
    ),
};
