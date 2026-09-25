import { SEED_ACTIVITIES } from '@/data/activities';
import { SEED_ACHIEVEMENTS } from '@/data/achievements';
import { SEED_BUILDINGS } from '@/data/buildings';
import { DEFAULT_AVATAR, DEFAULT_EQUIPPED, SEED_COSMETICS, SEED_REWARDS } from '@/data/cosmetics';
import { createDefaultSettings } from '@/data/defaultSettings';
import { createSeedPlan, SEED_EXERCISES, STARTING_WEIGHTS } from '@/data/exercises';
import { SEED_ROUTINES } from '@/data/routines';
import { createStreak } from '@/domain/streak';
import {
  achievementRepository,
  activityRepository,
  metaRepository,
  playerRepository,
  routineRepository,
  settingsRepository,
  tycoonRepository,
  withTransaction,
  workoutRepository,
} from '@/repositories';
import type { Player } from '@/types';
import { STAT_KEYS } from '@/types';

/** Bump when new seed content ships; missing ids are merged in without touching user edits. */
export const SEED_VERSION = 3;

export function createPlayer(name = 'Player', now = Date.now()): Player {
  return {
    id: 'me',
    name,
    level: 1,
    xp: 0,
    coins: 0,
    hp: 100,
    energy: 100,
    maxEnergy: 100,
    stats: Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Player['stats'],
    streak: createStreak(),
    inventory: { streakFreeze: 0, streakRevive: 0, reroll: 1 },
    boosts: [],
    effects: [],
    avatar: { ...DEFAULT_AVATAR },
    recoveryMode: false,
    lifetime: { xpEarned: 0, coinsEarned: 0, coinsSpent: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

async function mergeMissing<T extends { id: string }>(
  existing: T[],
  seeds: T[],
  put: (items: T[]) => Promise<void>,
): Promise<number> {
  const ids = new Set(existing.map((e) => e.id));
  const missing = seeds.filter((s) => !ids.has(s.id));
  if (missing.length) await put(missing);
  return missing.length;
}

/** Create or upgrade seed content. Returns true on the very first run. */
export async function ensureSeeded(): Promise<{ firstRun: boolean }> {
  await settingsRepository.migrate();
  const version = await metaRepository.get<number>('seedVersion');
  if (version === SEED_VERSION) return { firstRun: false };
  const firstRun = version === undefined;
  const now = Date.now();

  await withTransaction(async () => {
    if (!(await settingsRepository.get())) await settingsRepository.save(createDefaultSettings());
    if (!(await playerRepository.get())) await playerRepository.save(createPlayer('Player', now));

    const stamp = <T extends { createdAt: number; updatedAt?: number }>(x: T): T => ({ ...x, createdAt: now, updatedAt: now });
    await mergeMissing(await activityRepository.all(), SEED_ACTIVITIES.map(stamp), activityRepository.bulkPut);
    await mergeMissing(await routineRepository.all(), SEED_ROUTINES.map(stamp), routineRepository.bulkPut);
    await mergeMissing(await workoutRepository.exercises.all(), SEED_EXERCISES.map(stamp), workoutRepository.exercises.bulkPut);
    if ((await workoutRepository.plans.all()).length === 0) {
      await workoutRepository.plans.put({ ...createSeedPlan(), createdAt: now, updatedAt: now });
    }
    const states = await workoutRepository.states.all();
    const stateIds = new Set(states.map((s) => s.exerciseId));
    const missingStates = SEED_EXERCISES.filter((e) => !stateIds.has(e.id)).map((e) => ({
      exerciseId: e.id,
      workingWeight: STARTING_WEIGHTS[e.id] ?? 0,
      repMin: e.repMin,
      repMax: e.repMax,
      updatedAt: now,
    }));
    if (missingStates.length) await workoutRepository.states.bulkPut(missingStates);

    await mergeMissing(await achievementRepository.all(), SEED_ACHIEVEMENTS, achievementRepository.bulkPut);
    await mergeMissing(
      await tycoonRepository.buildings.all(),
      SEED_BUILDINGS.map((b) => (b.level > 0 ? { ...b, builtAt: now } : b)),
      tycoonRepository.buildings.bulkPut,
    );
    await mergeMissing(
      await tycoonRepository.cosmetics.all(),
      SEED_COSMETICS.map((c) =>
        firstRun && DEFAULT_EQUIPPED.includes(c.id) ? { ...c, owned: true, equipped: true, acquiredAt: now } : c,
      ),
      tycoonRepository.cosmetics.bulkPut,
    );
    await mergeMissing(await tycoonRepository.rewards.all(), SEED_REWARDS.map((r) => ({ ...r, createdAt: now })), tycoonRepository.rewards.bulkPut);
    await metaRepository.set('seedVersion', SEED_VERSION);
  });
  return { firstRun };
}
