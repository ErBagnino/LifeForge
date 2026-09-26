import { SEED_BUILDINGS } from '@/data/buildings';
import { DEFAULT_EQUIPPED } from '@/data/cosmetics';
import { STARTING_WEIGHTS } from '@/data/exercises';
import { levelFromXp } from '@/domain/level';
import { aggregateMetrics, getDb, metaRepository, playerRepository, settingsRepository, withTransaction } from '@/repositories';
import { shiftDate, weekStart } from '@/utils/date';
import { clock } from './clock';
import type { ServiceResult } from './events';
import { wipeAllData } from './exportService';
import { ensureToday } from './game/dayService';
import { createPlayer } from './seedService';

/**
 * Resets requested through the Coach or Settings. None of them can be undone,
 * so the UI always shows `RESET_INFO[kind]` and asks for confirmation first
 * (a typed phrase for a full reset) and offers a backup export.
 */

export type ResetKind = 'today' | 'week' | 'workouts' | 'nutrition' | 'game' | 'all';

export const RESET_PHRASE = 'RESET EVERYTHING';

export const RESET_INFO: Record<ResetKind, { title: string; deletes: string[]; keeps: string[] }> = {
  today: {
    title: 'Reset today',
    deletes: ["Today's quests and their progress", "Today's logs (steps, water, meals…)", 'XP and coins earned today', "Today's workout sessions"],
    keeps: ['Settings, activities and plans', 'Previous days', 'Achievements already unlocked and lifetime counters'],
  },
  week: {
    title: 'Reset this week',
    deletes: ["This week's quests, day results and logs", "This week's meals and workout sessions", 'XP and coins earned this week'],
    keeps: ['Settings, activities and plans', 'Earlier weeks', 'Streak, achievements and lifetime counters'],
  },
  workouts: {
    title: 'Reset workout history',
    deletes: ['All workout sessions', 'Exercise personal records', 'Working weights (back to the starting values)'],
    keeps: ['Workout plan and exercises', 'Everything else'],
  },
  nutrition: {
    title: 'Reset nutrition history',
    deletes: ['All meals (and their photos)', 'Calories, protein, carbs, fat and water logs'],
    keeps: ['Nutrition targets', 'Everything else'],
  },
  game: {
    title: 'Reset game progress',
    deletes: ['Level, XP and coins', 'HP, energy, streaks and inventory', 'Unlocked achievements and counters', 'Tycoon rooms and owned cosmetics'],
    keeps: ['History: logs, meals, workouts, day results', 'Settings, activities, routines and plans'],
  },
  all: {
    title: 'Reset EVERYTHING',
    deletes: ['Game progress, level, XP, coins', 'All history: quests, logs, meals, workouts', 'Settings, activities, routines, plans, achievements', 'Coach chat, AI usage stats and change log'],
    keeps: ['Nothing. The app restarts from onboarding. Export a backup first if you might want it back.'],
  },
};

async function resetRange(from: string, to: string): Promise<void> {
  const db = getDb();
  await withTransaction(async () => {
    const quests = await db.quests.where('date').between(from, to, true, true).toArray();
    await db.quests.bulkDelete(quests.map((q) => q.id));
    await db.metrics.where('date').between(from, to, true, true).delete();
    await db.meals.where('date').between(from, to, true, true).delete();
    await db.sessions.where('date').between(from, to, true, true).delete();
    const ledger = await db.ledger.where('date').between(from, to, true, true).toArray();
    // Achievements stay unlocked (counters are lifetime), so their rewards stay too.
    const reverted = ledger.filter((l) => !l.reason.startsWith('Achievement'));
    const player = await playerRepository.get();
    const settings = await settingsRepository.get();
    if (player && settings) {
      const xp = reverted.filter((l) => l.type === 'xp').reduce((s, l) => s + l.amount, 0);
      const coins = reverted.filter((l) => l.type === 'coins').reduce((s, l) => s + l.amount, 0);
      const firstLog = await db.dayLogs.get(from);
      player.xp = Math.max(0, player.xp - xp);
      player.lifetime.xpEarned = Math.max(0, player.lifetime.xpEarned - Math.max(0, xp));
      player.coins = Math.max(0, player.coins - coins);
      player.level = levelFromXp(player.xp, settings.rules.level).level;
      if (firstLog) player.hp = firstLog.hpStart;
      await playerRepository.save(player);
    }
    await db.ledger.bulkDelete(reverted.map((l) => l.id));
    await db.dayLogs.where('date').between(from, to, true, true).delete();
    await metaRepository.remove('currentDate');
  });
}

export async function runReset(kind: ResetKind): Promise<ServiceResult> {
  const db = getDb();
  const today = clock.today();
  switch (kind) {
    case 'today':
      await resetRange(today, today);
      break;
    case 'week':
      await resetRange(weekStart(today), today);
      break;
    case 'workouts':
      await withTransaction(async () => {
        await db.sessions.clear();
        const records = await db.records.toArray();
        await db.records.bulkDelete(records.filter((r) => r.kind.startsWith('exercise_')).map((r) => r.id));
        const states = await db.exerciseStates.toArray();
        await db.exerciseStates.bulkPut(states.map((s) => ({ ...s, workingWeight: STARTING_WEIGHTS[s.exerciseId] ?? 0, updatedAt: clock.now() })));
      });
      break;
    case 'nutrition':
      await withTransaction(async () => {
        await db.meals.clear();
        const types = ['calories', 'protein', 'carbs', 'fat', 'water'];
        const entries = await db.metrics.toArray();
        await db.metrics.bulkDelete(entries.filter((m) => types.includes(m.type)).map((m) => m.id));
        // Day logs cache their totals: recompute them from what is left, or today would still show the old intake.
        const left = entries.filter((m) => !types.includes(m.type));
        const logs = await db.dayLogs.toArray();
        await db.dayLogs.bulkPut(logs.map((l) => ({ ...l, metrics: aggregateMetrics(left.filter((m) => m.date === l.date)) })));
      });
      break;
    case 'game':
      await withTransaction(async () => {
        const old = await playerRepository.get();
        const fresh = createPlayer(old?.name ?? 'Player', clock.now());
        await playerRepository.save({ ...fresh, avatar: old?.avatar ?? fresh.avatar, createdAt: old?.createdAt ?? fresh.createdAt });
        const achievements = await db.achievements.toArray();
        await db.achievements.bulkPut(achievements.map((a) => ({ ...a, unlockedAt: undefined, seen: undefined })));
        await db.counters.clear();
        await db.ledger.clear();
        await db.redemptions.clear();
        const seedLevel = new Map(SEED_BUILDINGS.map((b) => [b.id, b.level]));
        const buildings = await db.buildings.toArray();
        await db.buildings.bulkPut(buildings.map((b) => ({ ...b, level: seedLevel.get(b.id) ?? 0, upgradedAt: undefined })));
        const cosmetics = await db.cosmetics.toArray();
        await db.cosmetics.bulkPut(cosmetics.map((c) => ({ ...c, owned: DEFAULT_EQUIPPED.includes(c.id), equipped: DEFAULT_EQUIPPED.includes(c.id) })));
        const quests = await db.quests.where('date').aboveOrEqual(shiftDate(today, -6)).toArray();
        await db.quests.bulkDelete(quests.filter((q) => q.date >= today || q.kind === 'weekly' || q.kind === 'boss').map((q) => q.id));
        await db.dayLogs.delete(today);
        await metaRepository.remove('currentDate');
      });
      break;
    case 'all':
      await wipeAllData();
      return { events: [] };
  }
  return ensureToday();
}
