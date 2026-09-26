import type { RoutingAttempt } from '@/ai/shared/models';
import { applyAttempts, buildHints, EMPTY_STATS, type RouterStats } from '@/domain/aiRouter';
import { metaRepository, settingsRepository } from '@/repositories';
import type { ModelHint } from '@/ai/shared/models';
import { usageRecords } from './usageService';

/**
 * The app's memory of the model router: per-model health, cooldowns, learned limits,
 * fallback counts and recent errors. Serverless instances don't share memory, so this
 * is sent back as hints with every request (it can only make the router avoid models).
 */

const KEY = 'aiRouter';
let cached: RouterStats | undefined;
const listeners = new Set<() => void>();

export function onRouterChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getRouterStats(): Promise<RouterStats> {
  if (!cached) cached = (await metaRepository.get<RouterStats>(KEY).catch(() => undefined)) ?? EMPTY_STATS;
  return cached;
}

export async function noteRouting(attempts: RoutingAttempt[], final: { model?: string; reason?: string; requestType?: string; fallback?: boolean }): Promise<void> {
  if (!attempts.length && !final.model) return;
  const next = applyAttempts(await getRouterStats(), attempts, final);
  cached = next;
  await metaRepository.set(KEY, next).catch(() => undefined);
  listeners.forEach((l) => l());
}

export async function clearRouterStats(): Promise<void> {
  cached = EMPTY_STATS;
  await metaRepository.remove(KEY).catch(() => undefined);
  listeners.forEach((l) => l());
}

export async function currentHints(): Promise<Record<string, ModelHint>> {
  try {
    const s = await settingsRepository.get();
    if (!s) return {};
    return buildHints(await usageRecords(), s.coach.ai.usage, await getRouterStats());
  } catch {
    return {};
  }
}

/** Forget cached state (tests / after a full reset). */
export function resetRouterCache(): void {
  cached = undefined;
}
