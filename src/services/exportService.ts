import { z } from 'zod';
import { APP_CONFIG } from '@/config/app';
import { getDb, TABLE_NAMES, type TableName } from '@/repositories';
import { QUEST_TIERS } from '@/types';

export interface ExportFile {
  app: string;
  format: number;
  exportedAt: string;
  dbVersion: number;
  data: Partial<Record<TableName, unknown[]>>;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keyed = (key: string) => z.array(z.looseObject({ [key]: z.string().min(1) }));

/** Structural validation per table: enough to reject malformed or foreign files safely. */
const TABLE_SCHEMAS: Record<TableName, z.ZodType> = {
  meta: keyed('key'),
  player: z
    .array(
      z.looseObject({
        id: z.literal('me'),
        level: z.number().int().min(1),
        xp: z.number().min(0),
        coins: z.number().min(0),
        hp: z.number().min(0).max(100),
        energy: z.number().min(0),
        stats: z.record(z.string(), z.number()),
        streak: z.looseObject({ current: z.number().min(0), longest: z.number().min(0) }),
        inventory: z.looseObject({ streakFreeze: z.number(), streakRevive: z.number(), reroll: z.number() }),
      }),
    )
    .max(1),
  settings: z.array(z.looseObject({ id: z.literal('settings'), schedule: z.looseObject({ days: z.array(z.unknown()).length(7) }), rules: z.looseObject({}) })).max(1),
  activities: z.array(z.looseObject({ id: z.string(), name: z.string(), category: z.string(), tier: z.enum(QUEST_TIERS), recurrence: z.looseObject({ type: z.string() }) })),
  routines: keyed('id'),
  quests: z.array(
    z.looseObject({
      id: z.string(),
      date: isoDate,
      kind: z.string(),
      tier: z.enum(QUEST_TIERS),
      title: z.string(),
      status: z.enum(['pending', 'completed', 'skipped', 'failed', 'moved']),
      xp: z.number(),
      coins: z.number(),
    }),
  ),
  dayLogs: z.array(z.looseObject({ date: isoDate, score: z.number(), metrics: z.record(z.string(), z.number()) })),
  dayPlans: z.array(z.looseObject({ date: isoDate })),
  metrics: z.array(z.looseObject({ id: z.string(), date: isoDate, type: z.string(), value: z.number(), ts: z.number() })),
  exercises: keyed('id'),
  plans: z.array(z.looseObject({ id: z.string(), templates: z.array(z.unknown()) })),
  sessions: z.array(z.looseObject({ id: z.string(), date: isoDate, status: z.string(), exercises: z.array(z.unknown()) })),
  exerciseStates: keyed('exerciseId'),
  achievements: z.array(z.looseObject({ id: z.string(), condition: z.looseObject({ type: z.string() }) })),
  records: keyed('id'),
  counters: z.array(z.looseObject({ key: z.string(), value: z.number() })),
  buildings: z.array(z.looseObject({ id: z.string(), level: z.number().int().min(0) })),
  cosmetics: keyed('id'),
  rewards: keyed('id'),
  redemptions: keyed('id'),
  suggestions: keyed('id'),
  notifications: keyed('id'),
  ledger: keyed('id'),
};

const EnvelopeSchema = z.object({
  app: z.string(),
  format: z.number().int().min(1),
  exportedAt: z.string(),
  dbVersion: z.number().optional(),
  data: z.record(z.string(), z.array(z.unknown())),
});

export async function exportData(): Promise<ExportFile> {
  const db = getDb();
  const data: ExportFile['data'] = {};
  for (const name of TABLE_NAMES) data[name] = await db.table(name).toArray();
  return { app: APP_CONFIG.name, format: APP_CONFIG.exportFormatVersion, exportedAt: new Date().toISOString(), dbVersion: db.verno, data };
}

export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportToFile(): Promise<void> {
  const file = await exportData();
  downloadJson(file, `${APP_CONFIG.shortName.toLowerCase()}-backup-${file.exportedAt.slice(0, 10)}.json`);
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  counts: Partial<Record<TableName, number>>;
  file?: ExportFile;
}

export function validateImport(raw: unknown): ValidationResult {
  const env = EnvelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, errors: ['Not a LifeForge backup file (missing app/format/data).'], counts: {} };
  const errors: string[] = [];
  if (env.data.app !== APP_CONFIG.name) errors.push(`This file belongs to "${env.data.app}", not ${APP_CONFIG.name}.`);
  if (env.data.format > APP_CONFIG.exportFormatVersion) errors.push('This backup was made by a newer version of the app.');
  const counts: ValidationResult['counts'] = {};
  for (const [name, rows] of Object.entries(env.data.data)) {
    if (!(TABLE_NAMES as readonly string[]).includes(name)) continue;
    const table = name as TableName;
    const r = TABLE_SCHEMAS[table].safeParse(rows);
    if (!r.success) {
      const issue = r.error.issues[0];
      errors.push(`${table}: ${issue.path.join('.')} ${issue.message}`);
    }
    counts[table] = rows.length;
  }
  if (!counts.player || !counts.settings) errors.push('Backup is missing the player or settings.');
  return { ok: errors.length === 0, errors, counts, file: errors.length ? undefined : (env.data as ExportFile) };
}

/** Replace all local data with a validated backup (atomic: all-or-nothing). */
export async function importData(file: ExportFile): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear();
    for (const name of TABLE_NAMES) {
      const rows = file.data[name];
      if (rows?.length) await db.table(name).bulkPut(rows);
    }
  });
}

export async function readFileAsJson(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
}

export async function wipeAllData(): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}
