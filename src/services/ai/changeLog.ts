import type { Table } from 'dexie';
import { getDb, withTransaction } from '@/repositories';
import type { LifeForgeDB } from '@/repositories/db';
import type { AiChange, ChangeSnapshot } from '@/types';
import { uid } from '@/utils/id';
import { clock } from '../clock';
import type { ServiceResult } from '../events';
import { refreshToday, uncompleteQuest } from '../game/questService';

/**
 * Change log for everything the Coach changes, with Undo.
 * While a tool runs, Dexie hooks capture the previous value of every configuration
 * record it touches (settings, activities, quests, goals, plans…). Undo restores those
 * values. Player totals are never snapshotted: rewards are reverted through the game
 * engine (e.g. uncompleteQuest), so XP/coins stay consistent.
 */

const TRACKED = ['settings', 'activities', 'routines', 'quests', 'plans', 'exercises', 'exerciseStates', 'achievements', 'buildings', 'dayPlans', 'meals', 'metrics'] as const;
const MAX_LOG = 60;

let recording: Map<string, ChangeSnapshot> | null = null;
const hooked = new WeakSet<LifeForgeDB>();

function ensureHooks(db: LifeForgeDB): void {
  if (hooked.has(db)) return;
  hooked.add(db);
  for (const name of TRACKED) {
    const table = (db as unknown as Record<string, Table<unknown, string>>)[name];
    const note = (key: unknown, before: unknown) => {
      if (!recording || key === undefined) return;
      const id = `${name}:${String(key)}`;
      if (!recording.has(id)) recording.set(id, { table: name, key: String(key), before: before === undefined ? undefined : structuredClone(before) });
    };
    table.hook('creating', (key) => note(key, undefined));
    table.hook('updating', (_mods, key, obj) => note(key, obj));
    table.hook('deleting', (key, obj) => note(key, obj));
  }
}

/** Run `fn` and return the snapshots of every tracked record it changed. */
export async function recordChanges<T>(fn: () => Promise<T>): Promise<{ value: T; entries: ChangeSnapshot[] }> {
  ensureHooks(getDb());
  if (recording) return { value: await fn(), entries: [] }; // nested: the outer call records
  const rec = new Map<string, ChangeSnapshot>();
  recording = rec;
  try {
    const value = await fn();
    return { value, entries: [...rec.values()] };
  } catch (e) {
    recording = null;
    // A failed multi-step change is rolled back so nothing is left half-applied.
    await restore([...rec.values()]).catch(() => undefined);
    throw e;
  } finally {
    recording = null;
  }
}

async function restore(entries: ChangeSnapshot[]): Promise<void> {
  const db = getDb();
  await withTransaction(async () => {
    for (const e of [...entries].reverse()) {
      const table = (db as unknown as Record<string, Table<unknown, string>>)[e.table];
      if (!table) continue;
      if (e.before === undefined) await table.delete(e.key);
      else await table.put(e.before);
    }
  });
}

export async function logChange(change: Omit<AiChange, 'id' | 'ts'>): Promise<AiChange> {
  const db = getDb();
  const entry: AiChange = { ...change, id: uid('chg_'), ts: clock.now() };
  await db.aiChanges.put(entry);
  const all = await db.aiChanges.orderBy('ts').toArray();
  if (all.length > MAX_LOG) await db.aiChanges.bulkDelete(all.slice(0, all.length - MAX_LOG).map((c) => c.id));
  return entry;
}

export async function recentChanges(limit = 20): Promise<AiChange[]> {
  return (await getDb().aiChanges.orderBy('ts').reverse().limit(limit).toArray());
}

export async function getChange(id: string): Promise<AiChange | undefined> {
  return getDb().aiChanges.get(id);
}

export interface UndoResult extends ServiceResult {
  success: boolean;
  message: string;
}

export async function undoChange(id: string): Promise<UndoResult> {
  const change = await getChange(id);
  if (!change) return { success: false, message: 'Change not found.', events: [] };
  if (change.undoneAt) return { success: false, message: 'Already undone.', events: [] };
  if (!change.undo) return { success: false, message: 'This change can’t be undone.', events: [] };
  const db = getDb();
  let events: ServiceResult['events'] = [];

  if (change.undo.kind === 'uncomplete') {
    const q = await db.quests.get(change.undo.questId);
    if (!q || q.status !== 'completed') return { success: false, message: 'The quest is no longer completed.', events: [] };
    events = (await uncompleteQuest(change.undo.questId)).events;
  } else if (change.undo.kind === 'unskip') {
    const before = change.undo.before;
    await withTransaction(async () => {
      await db.quests.put(before as never);
    });
    events = (await refreshToday()).events;
  } else {
    await restore(change.undo.entries);
    events = (await refreshToday()).events;
  }
  await db.aiChanges.put({ ...change, undoneAt: clock.now() });
  return { success: true, message: `Undone: ${change.summary}`, events };
}

export async function clearChangeLog(): Promise<void> {
  await getDb().aiChanges.clear();
}
