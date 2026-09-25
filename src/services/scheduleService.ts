import { sideQuestBudget } from '@/domain/adaptive';
import { activeExceptions, applyWorkToPlan, resolveEntry, scheduledPlan } from '@/domain/schedule';
import { activityRepository, playerRepository, settingsRepository, statsRepository, tycoonRepository, workoutRepository } from '@/repositories';
import type { AvailabilityException, DayPlan, ISODate, KnownField, Knowledge, LoadMode, QuestTier, Settings, WorkDayEntry, WorkSchedule, WorkSettings } from '@/types';
import { shiftDate } from '@/utils/date';
import { uid } from '@/utils/id';
import { clock } from './clock';
import type { ServiceResult } from './events';
import { mergePlan, planFor } from './game/dayPlan';
import { rebuildDay } from './game/dayService';
import { adventureDay, capacityHistory, computeDayLoad } from './game/load';
import { loadDay } from './game/questService';
import { worldBonuses } from '@/domain/tycoon';

/**
 * Everything that changes *when* the player is available: the regular work week,
 * one-off days, time-boxed exceptions and the load mode. Each change that touches
 * today rebalances today's board.
 */

async function mustSettings(): Promise<Settings> {
  const s = await settingsRepository.get();
  if (!s) throw new Error('Game not initialised');
  return s;
}

async function saveAndRebalance(next: Settings, affectsToday = true): Promise<ServiceResult> {
  await settingsRepository.save(next);
  return affectsToday ? rebuildDay(clock.today()) : { events: [] };
}

// ——— Regular work week ———

export async function saveWorkSettings(work: WorkSettings): Promise<ServiceResult> {
  const s = await mustSettings();
  return saveAndRebalance({ ...s, work });
}

/** "I don't know yet": keep past versions for history, but plan without work info. */
export async function setWorkUnknown(): Promise<ServiceResult> {
  const s = await mustSettings();
  return saveAndRebalance({ ...s, work: { ...s.work, status: 'unknown' } });
}

/** Add a schedule version (replaces one starting the same day). */
export function withSchedule(work: WorkSettings, schedule: WorkSchedule): WorkSettings {
  const others = work.schedules.filter((x) => x.effectiveFrom !== schedule.effectiveFrom && x.id !== schedule.id);
  return { status: 'set', schedules: [...others, schedule].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)) };
}

export async function addWorkSchedule(schedule: WorkSchedule): Promise<ServiceResult> {
  const s = await mustSettings();
  return saveAndRebalance({ ...s, work: withSchedule(s.work, schedule) }, schedule.effectiveFrom <= clock.today());
}

export async function removeWorkSchedule(id: string): Promise<ServiceResult> {
  const s = await mustSettings();
  const schedules = s.work.schedules.filter((x) => x.id !== id);
  return saveAndRebalance({ ...s, work: { status: schedules.length ? s.work.status : 'not_set', schedules } });
}

export function newSchedule(days: WorkDayEntry[], effectiveFrom: ISODate, source: WorkSchedule['source'], extra: Partial<WorkSchedule> = {}): WorkSchedule {
  return { id: uid('ws_'), effectiveFrom, days, source, createdAt: Date.now(), ...extra };
}

// ——— One-off days ———

/** "Tomorrow I work 10–20": a temporary schedule for that date only. */
export function temporaryPlan(base: DayPlan, entry: WorkDayEntry, note?: string): DayPlan {
  return { ...applyWorkToPlan({ ...base, dayType: base.dayType === 'rest' ? 'rest' : 'free' }, resolveEntry(entry)), temporary: true, note };
}

export async function setTemporaryWork(date: ISODate, entry: WorkDayEntry, note?: string): Promise<ServiceResult> {
  const s = await mustSettings();
  const base = mergePlan(scheduledPlan(date, s), await nonTemporary(date));
  await statsRepository.putPlan(temporaryPlan(base, entry, note));
  return date === clock.today() ? rebuildDay(date) : { events: [] };
}

export async function clearTemporaryWork(date: ISODate): Promise<ServiceResult> {
  const stored = await statsRepository.getPlan(date);
  if (stored?.temporary) await statsRepository.removePlan(date);
  return date === clock.today() ? rebuildDay(date) : { events: [] };
}

async function nonTemporary(date: ISODate): Promise<DayPlan | undefined> {
  const stored = await statsRepository.getPlan(date);
  return stored?.temporary ? undefined : stored;
}

/** Upcoming one-off days (today included). */
export async function upcomingTemporary(from: ISODate = clock.today(), days = 60): Promise<DayPlan[]> {
  const out: DayPlan[] = [];
  for (let i = 0; i <= days; i++) {
    const p = await statsRepository.getPlan(shiftDate(from, i));
    if (p?.temporary) out.push(p);
  }
  return out;
}

// ——— Training availability ———

/** Map the program onto training days, or make it flexible ("not sure yet"). */
export async function assignTrainingDays(days: number[] | 'unknown'): Promise<ServiceResult> {
  const s = await mustSettings();
  const flexible = days === 'unknown' || !days.length;
  const plan = await workoutRepository.activePlan();
  if (plan) {
    const sorted = flexible ? [] : [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    await workoutRepository.plans.put({ ...plan, templates: plan.templates.map((t, i) => ({ ...t, weekday: flexible ? null : (sorted[i] ?? null) })) });
  }
  return saveAndRebalance({
    ...s,
    known: { ...s.known, training: flexible ? 'unknown' : 'set' },
    schedule: { ...s.schedule, days: s.schedule.days.map((d, i) => ({ ...d, trainingAvailable: flexible || days.includes(i) })) },
  });
}

// ——— Exceptions, load mode, knowledge ———

export async function addException(e: Omit<AvailabilityException, 'id' | 'createdAt'>): Promise<ServiceResult> {
  const s = await mustSettings();
  const ex: AvailabilityException = { ...e, id: uid('ex_'), createdAt: Date.now() };
  const today = clock.today();
  return saveAndRebalance({ ...s, exceptions: [...s.exceptions, ex] }, ex.from <= today && (!ex.to || ex.to >= today));
}

export async function removeException(id: string): Promise<ServiceResult> {
  const s = await mustSettings();
  return saveAndRebalance({ ...s, exceptions: s.exceptions.filter((e) => e.id !== id) });
}

export async function setLoadMode(mode: LoadMode): Promise<ServiceResult> {
  const s = await mustSettings();
  return saveAndRebalance({ ...s, load: { mode } });
}

export async function setKnown(field: KnownField, value: Knowledge, patch: (s: Settings) => Settings = (x) => x): Promise<ServiceResult> {
  const s = await mustSettings();
  const next = patch({ ...s, known: { ...s.known, [field]: value } });
  return saveAndRebalance(next, field === 'wake' || field === 'sleep' || field === 'training');
}

/** Drop exceptions that ended more than a week ago (keeps settings small). */
export function pruneExceptions(list: AvailabilityException[], today: ISODate): AvailabilityException[] {
  const c = shiftDate(today, -7);
  return list.filter((e) => !e.to || e.to >= c);
}

export function currentExceptions(s: Settings, date: ISODate = clock.today()): AvailabilityException[] {
  return [...activeExceptions(s.exceptions, date), ...s.exceptions.filter((e) => e.from > date)];
}

// ——— Rebalance preview ———

export interface RebalanceChange {
  questId: string;
  title: string;
  icon: string;
  from: QuestTier;
  to: QuestTier;
}

export interface RebalancePreview {
  before: { score: number; capacity?: number };
  after: { score: number; capacity: number; level: string };
  changes: RebalanceChange[];
  sideSlots: number;
  reasons: string[];
}

/**
 * What today's board would look like with `settings` (and optionally a different plan),
 * without writing anything. Used by the Coach to show the impact before applying.
 */
export async function previewRebalance(settings: Settings, date: ISODate = clock.today(), planOverride?: DayPlan): Promise<RebalancePreview> {
  const [player, activities, { day }, log, buildings] = await Promise.all([
    playerRepository.get(),
    activityRepository.all(),
    loadDay(date),
    statsRepository.getLog(date),
    tycoonRepository.buildings.all(),
  ]);
  if (!player) throw new Error('Game not initialised');
  const plan = planOverride ?? (await planFor(date, settings));
  const bonuses = worldBonuses(buildings);
  const maxEnergy = settings.rules.energy.base + bonuses.maxEnergy;
  const load = computeDayLoad({
    settings,
    plan,
    date,
    energy: player.energy,
    maxEnergy,
    history: await capacityHistory(date),
    dayIndex: await adventureDay(date, player, settings),
    quests: day,
    activities,
    state: log?.difficultyState,
  });
  const changes: RebalanceChange[] = [];
  for (const q of day) {
    const d = load.decisions.get(q.id);
    if (!d) continue;
    const to = d.lightened && !q.kept ? d.tier : (q.baseTier ?? q.tier);
    if (to !== q.tier) changes.push({ questId: q.id, title: q.title, icon: q.icon, from: q.tier, to });
  }
  const budget = sideQuestBudget(
    {
      workloadLevel: load.level,
      state: log?.difficultyState ?? 'balanced',
      preset: settings.rules.difficultyPresets[settings.difficulty],
      extraSlots: bonuses.sideQuestSlots,
      energyAfterCore: player.energy,
      freeAfterQuestsMin: load.leftoverMin,
      dayType: plan.dayType,
    },
    settings.rules.generator,
  );
  return {
    before: { score: log?.workload ?? 0, capacity: log?.capacityMin },
    after: { score: load.score, capacity: load.capacity.minutes, level: load.level },
    changes,
    sideSlots: budget.count,
    reasons: load.capacity.reasons,
  };
}
