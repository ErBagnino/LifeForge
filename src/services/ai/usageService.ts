import { summarizeUsage, type UsageSummary } from '@/domain/aiUsage';
import { getDb, settingsRepository } from '@/repositories';
import type { AiUsageRecord } from '@/types';
import { uid } from '@/utils/id';

/** Official source for real usage and limits (Google AI Studio → Usage). */
export const OFFICIAL_USAGE_URL = 'https://aistudio.google.com/usage';

const KEEP_DAYS = 45;
const listeners = new Set<() => void>();

export function onUsageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Record one Gemini request (metadata only). No-op when tracking is off. */
export async function recordUsage(r: Omit<AiUsageRecord, 'id'>): Promise<void> {
  try {
    const s = await settingsRepository.get();
    if (s && !s.coach.ai.usage.tracking) return;
    const db = getDb();
    await db.aiUsage.put({ ...r, id: uid('u_') });
    await db.aiUsage.where('ts').below(Date.now() - KEEP_DAYS * 86_400_000).delete();
  } catch {
    // tracking must never break a request
  }
  listeners.forEach((l) => l());
}

export async function usageRecords(): Promise<AiUsageRecord[]> {
  return getDb().aiUsage.toArray();
}

export async function getUsageSummary(now = Date.now()): Promise<UsageSummary | undefined> {
  const s = await settingsRepository.get();
  if (!s) return undefined;
  return summarizeUsage(await usageRecords(), s.coach.ai.usage, now);
}

export async function clearUsage(): Promise<void> {
  await getDb().aiUsage.clear();
  listeners.forEach((l) => l());
}
