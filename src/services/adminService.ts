import { DEFAULT_RULES } from '@/data/defaultRules';
import { C } from '@/domain/counters';
import {
  activityRepository,
  getDb,
  questRepository,
  routineRepository,
  settingsRepository,
  statsRepository,
  tycoonRepository,
  withTransaction,
  workoutRepository,
} from '@/repositories';
import type { Activity, Building, Exercise, GameRules, ID, Routine, Settings, WorkoutPlan } from '@/types';
import { shiftDate } from '@/utils/date';
import { clock } from './clock';
import type { ServiceResult } from './events';
import { GameTx } from './game/gameTx';
import { questFromActivity } from './game/questFactory';
import { applyCompletion, settleDay } from './game/questService';
import { haptics } from './haptics';

export async function saveSettings(next: Settings): Promise<void> {
  await settingsRepository.save(next);
  clock.setDayStartHour(next.dayStartHour);
  haptics.setEnabled(next.haptics);
}

export async function saveRules(rules: GameRules): Promise<void> {
  const s = await settingsRepository.get();
  if (s) await settingsRepository.save({ ...s, rules });
}

export async function resetRules(): Promise<void> {
  await saveRules(structuredClone(DEFAULT_RULES));
}

/** Create or update an activity; today's pending quest (if any) picks up the change. */
export async function saveActivity(activity: Activity, opts: { isNew?: boolean } = {}): Promise<ServiceResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(clock.today());
    const next = { ...activity, updatedAt: tx.now };
    await activityRepository.put(next);
    if (opts.isNew && next.userCreated) tx.inc({ [C.activitiesCreated]: 1 });
    const todays = (await questRepository.byDate(tx.date)).filter((q) => q.activityId === next.id && q.status === 'pending' && q.kind !== 'side');
    for (const q of todays) {
      if (!next.active) {
        await questRepository.remove(q.id);
        continue;
      }
      const fresh = questFromActivity(next, { settings: tx.settings, level: tx.level, date: tx.date, now: tx.now }, { kind: q.kind, tier: q.lightened ? q.tier : next.tier });
      await questRepository.put({ ...fresh, id: q.id, progress: q.progress, snoozeCount: q.snoozeCount, snoozedUntil: q.snoozedUntil, createdAt: q.createdAt });
    }
    await settleDay(tx);
    await tx.checkAchievements();
    await tx.commit();
    return { events: tx.events };
  });
}

export async function deleteActivity(id: ID): Promise<void> {
  await withTransaction(async () => {
    await activityRepository.remove(id);
    const todays = (await questRepository.byDate(clock.today())).filter((q) => q.activityId === id && q.status === 'pending');
    for (const q of todays) await questRepository.remove(q.id);
    for (const r of await routineRepository.all()) {
      if (r.activityIds.includes(id)) await routineRepository.put({ ...r, activityIds: r.activityIds.filter((x) => x !== id) });
    }
  });
}

export async function importActivities(activities: Activity[]): Promise<ServiceResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(clock.today());
    await activityRepository.bulkPut(activities);
    tx.inc({ [C.aiImported]: activities.length, [C.activitiesCreated]: activities.length });
    await tx.checkAchievements();
    await tx.commit();
    tx.events.push({ type: 'toast', text: `Imported ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}.`, icon: '🤖', tone: 'success' });
    return { events: tx.events };
  });
}

export async function savePlan(plan: WorkoutPlan): Promise<void> {
  await workoutRepository.plans.put({ ...plan, updatedAt: clock.now() });
}

export async function saveExercise(ex: Exercise): Promise<void> {
  await workoutRepository.exercises.put({ ...ex, updatedAt: clock.now() });
  if (!(await workoutRepository.states.get(ex.id))) {
    await workoutRepository.states.put({ exerciseId: ex.id, workingWeight: 0, repMin: ex.repMin, repMax: ex.repMax, updatedAt: clock.now() });
  }
}

export async function saveBuilding(b: Building): Promise<void> {
  await tycoonRepository.buildings.put(b);
}

export async function saveRoutine(r: Routine): Promise<void> {
  await routineRepository.put({ ...r, updatedAt: clock.now() });
}

export async function deleteRoutine(id: ID): Promise<void> {
  await routineRepository.remove(id);
}

/** Add a routine's missing quests to today (e.g. start the Recovery Routine now). */
export async function startRoutine(routineId: ID): Promise<ServiceResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(clock.today());
    const r = await routineRepository.get(routineId);
    if (!r) return { events: [] };
    const today = await questRepository.byDate(tx.date);
    const have = new Set(today.filter((q) => q.status !== 'moved').map((q) => q.activityId));
    const added = [];
    for (const id of r.activityIds) {
      if (have.has(id)) continue;
      const a = await activityRepository.get(id);
      if (!a) continue;
      added.push(questFromActivity(a, { settings: tx.settings, level: tx.level, date: tx.date, now: tx.now }, { kind: 'manual', tier: 'optional', reason: `Part of ${r.name}` }));
    }
    await questRepository.bulkPut(added);
    await settleDay(tx);
    await tx.commit();
    tx.events.push({ type: 'toast', text: added.length ? `${r.name} started: ${added.length} quests added.` : `${r.name} is already on today's board.`, icon: r.icon, tone: 'info' });
    return { events: tx.events };
  });
}

export async function tableCounts(): Promise<Record<string, number>> {
  const db = getDb();
  const out: Record<string, number> = {};
  for (const t of db.tables) out[t.name] = await t.count();
  return out;
}

export async function markReviewed(kind: 'daily' | 'weekly'): Promise<ServiceResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(clock.today());
    if (kind === 'daily') {
      if (tx.log.reviewed) return { events: [] };
      tx.log.reviewed = true;
      tx.inc({ [C.reviewsDaily]: 1 });
      const review = (await questRepository.byDate(tx.date)).find((q) => q.activityId === 'daily_review' && q.status === 'pending');
      if (review) await applyCompletion(tx, review);
    } else {
      tx.inc({ [C.reviewsWeekly]: 1 });
    }
    await settleDay(tx);
    await tx.commit();
    return { events: tx.events };
  });
}

export async function lastLogs(days: number) {
  const today = clock.today();
  return statsRepository.logs(shiftDate(today, -days), today);
}
