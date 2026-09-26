import { C, countersForMetric } from '@/domain/counters';
import { rebaseEnergyForSleep, startingEnergy } from '@/domain/energy';
import { type LeisureTimer, MAX_SESSION_MIN, splitSession } from '@/domain/leisure';
import { detectRecords } from '@/domain/records';
import {
  aggregateMetrics,
  metaRepository,
  questRepository,
  settingsRepository,
  statsRepository,
  withTransaction,
} from '@/repositories';
import type { ISODate, LeisureKind, Meal, MetricEntry, MetricSource, MetricType, Quest } from '@/types';
import { dateTimeToTs, gameDate, shiftDate, weekEnd, weekStart } from '@/utils/date';
import { uid } from '@/utils/id';
import { clock } from './clock';
import { GameTx } from './game/gameTx';
import { applyCompletion, type QuestResult, settleDay } from './game/questService';

/** How a quick-log input combines with the day's existing value. */
export const METRIC_INPUT: Record<MetricType, { label: string; unit: string; icon: string; mode: 'add' | 'set'; step: number }> = {
  water: { label: 'Water', unit: 'ml', icon: '💧', mode: 'add', step: 250 },
  steps: { label: 'Steps', unit: 'steps', icon: '👟', mode: 'set', step: 500 },
  weight: { label: 'Weight', unit: 'kg', icon: '⚖️', mode: 'set', step: 0.1 },
  sleep: { label: 'Sleep', unit: 'h', icon: '😴', mode: 'set', step: 0.25 },
  calories: { label: 'Calories', unit: 'kcal', icon: '🔥', mode: 'add', step: 50 },
  protein: { label: 'Protein', unit: 'g', icon: '🥩', mode: 'add', step: 5 },
  carbs: { label: 'Carbs', unit: 'g', icon: '🍚', mode: 'add', step: 5 },
  fat: { label: 'Fat', unit: 'g', icon: '🥑', mode: 'add', step: 5 },
  distance: { label: 'Distance', unit: 'km', icon: '📏', mode: 'add', step: 0.5 },
  activeCalories: { label: 'Active calories', unit: 'kcal', icon: '⚡', mode: 'add', step: 25 },
  workoutMinutes: { label: 'Workout time', unit: 'min', icon: '⏱️', mode: 'add', step: 5 },
  leisure: { label: 'Play time', unit: 'min', icon: '🎮', mode: 'add', step: 5 },
};

/** Sync metric-driven quests (auto-complete, or fail an "at most" budget). */
async function syncMetricQuests(tx: GameTx, type: MetricType, value: number): Promise<void> {
  const quests = (await questRepository.byDate(tx.date)).filter((q) => q.metric === type && q.status !== 'moved');
  for (const q of quests) {
    let next: Quest = { ...q, progress: value, updatedAt: tx.now };
    if (q.metricMode === 'atMost') {
      const over = q.target !== undefined && value > q.target;
      if (over && q.status !== 'failed' && q.status !== 'skipped') {
        if (q.status === 'completed' && q.earned) {
          tx.addXp(-q.earned.xp, `Budget exceeded: ${q.title}`, q.id);
          tx.addCoins(-q.earned.coins, `Budget exceeded: ${q.title}`, q.id);
        }
        next = { ...next, status: 'failed', earned: undefined };
        tx.events.push({ type: 'toast', text: 'Play-time budget exceeded for today. Tomorrow is a clean slate.', icon: '⛔', tone: 'warn' });
      } else if (!over && q.status === 'failed') {
        next = { ...next, status: 'pending' };
      }
      await questRepository.put(next);
      continue;
    }
    await questRepository.put(next);
    if (q.status === 'pending' && q.target !== undefined && value >= q.target) await applyCompletion(tx, next);
  }
}

export interface LogMetricOptions {
  date?: ISODate;
  mode?: 'add' | 'set';
  note?: string;
  source?: MetricSource;
  refId?: string;
}

export function logMetric(type: MetricType, value: number, opts: LogMetricOptions = {}): Promise<QuestResult> {
  return withTransaction(async () => {
    const date = opts.date ?? clock.today();
    const tx = await GameTx.open(date);
    const mode = opts.mode ?? METRIC_INPUT[type].mode;
    const before = aggregateMetrics(await statsRepository.metricsByDate(date));
    const prevValue = before[type] ?? 0;
    const entryValue = mode === 'set' && (type === 'water' || type === 'calories' || type === 'protein' || type === 'carbs' || type === 'fat' || type === 'leisure' || type === 'distance') ? value - prevValue : value;
    const entry: MetricEntry = { id: uid('m_'), date, type, value: entryValue, ts: tx.now, note: opts.note, source: opts.source ?? 'manual', refId: opts.refId };
    await statsRepository.addMetric(entry);
    const after = aggregateMetrics(await statsRepository.metricsByDate(date));
    const nextValue = after[type] ?? 0;
    tx.log.metrics = after;
    tx.inc(countersForMetric(type, nextValue - prevValue));

    if (type === 'sleep' && date === clock.today() && !tx.log.closed) {
      const newStart = startingEnergy(
        { sleepHours: nextValue, restDay: tx.log.restDay, maxEnergy: tx.maxEnergy, recoveryMode: tx.player.recoveryMode },
        tx.settings.rules.energy,
      );
      tx.player.energy = rebaseEnergyForSleep(tx.player.energy, tx.log.energyStart, newStart, tx.maxEnergy);
      tx.log.energyStart = newStart;
    }
    if (type === 'weight' && tx.settings.tracking.weight) {
      await settingsRepository.save({ ...tx.settings, body: { ...tx.settings.body, weightKg: nextValue } });
    }
    if (type === 'steps') {
      const records = new Map((await statsRepository.records()).map((r) => [r.id, r]));
      const week = aggregateWeek(await statsRepository.metricsOfType('steps', weekStart(date), weekEnd(date)), date, nextValue);
      const prs = detectRecords(
        [
          { id: 'steps:day', kind: 'steps_day', label: 'Most steps in a day', value: nextValue, unit: 'steps' },
          { id: 'steps:week', kind: 'steps_week', label: 'Most steps in a week', value: week, unit: 'steps' },
        ],
        records,
        date,
        tx.now,
      ).filter((r) => r.previous !== undefined || r.value >= 5000);
      if (prs.length) {
        await statsRepository.putRecords(prs);
        tx.inc({ [C.prsTotal]: prs.length, [C.prsSteps]: prs.length });
        for (const record of prs) if (record.previous !== undefined) tx.events.push({ type: 'record', record });
      }
    }

    if (!tx.log.closed) {
      await syncMetricQuests(tx, type, nextValue);
      await settleDay(tx);
    }
    await tx.commit();
    return { events: tx.events, features: tx.unlockedFeatures };
  });
}

function aggregateWeek(entries: MetricEntry[], date: ISODate, todayValue: number): number {
  const byDay = new Map<string, MetricEntry>();
  for (const e of entries) {
    const prev = byDay.get(e.date);
    if (!prev || prev.ts <= e.ts) byDay.set(e.date, e);
  }
  let total = 0;
  for (const [d, e] of byDay) total += d === date ? todayValue : e.value;
  if (!byDay.has(date)) total += todayValue;
  return total;
}

export function deleteMetric(entry: MetricEntry): Promise<QuestResult> {
  return withTransaction(async () => {
    const tx = await GameTx.open(entry.date);
    await statsRepository.removeMetric(entry.id);
    const after = aggregateMetrics(await statsRepository.metricsByDate(entry.date));
    tx.log.metrics = after;
    if (!tx.log.closed) {
      await syncMetricQuests(tx, entry.type, after[entry.type] ?? 0);
      await settleDay(tx);
    }
    await tx.commit();
    return { events: tx.events, features: tx.unlockedFeatures };
  });
}

export async function metricEntries(date: ISODate): Promise<MetricEntry[]> {
  return (await statsRepository.metricsByDate(date)).sort((a, b) => b.ts - a.ts);
}

// ——— Play-time (leisure) timer ———

const TIMER_KEY = 'leisureTimer';

export async function getLeisureTimer(): Promise<LeisureTimer | undefined> {
  return metaRepository.get<LeisureTimer>(TIMER_KEY);
}

export async function startLeisure(kind: LeisureKind): Promise<LeisureTimer> {
  const existing = await getLeisureTimer();
  if (existing) return existing;
  const timer: LeisureTimer = { startedAt: clock.now(), kind };
  await metaRepository.set(TIMER_KEY, timer);
  return timer;
}

export async function cancelLeisure(): Promise<void> {
  await metaRepository.remove(TIMER_KEY);
}

/** Stop the timer and log the minutes (split across the day boundary; capped at 6 h). */
export async function stopLeisure(): Promise<QuestResult & { minutes: number }> {
  const timer = await getLeisureTimer();
  if (!timer) return { events: [], features: [], minutes: 0 };
  await metaRepository.remove(TIMER_KEY);
  const settings = await settingsRepository.get();
  const dsh = settings?.dayStartHour ?? 4;
  let end = clock.now();
  const events: QuestResult['events'] = [];
  if ((end - timer.startedAt) / 60000 > MAX_SESSION_MIN) {
    end = timer.startedAt + MAX_SESSION_MIN * 60000;
    events.push({ type: 'toast', text: 'Timer ran over 6 h — capped. Adjust manually if needed.', icon: '⏱️', tone: 'warn' });
  }
  const startDate = gameDate(timer.startedAt, dsh);
  const nextDate = shiftDate(startDate, 1);
  const boundary = dateTimeToTs(nextDate, `${String(dsh).padStart(2, '0')}:00`, dsh);
  const { first, second } = splitSession(timer.startedAt, end, boundary);
  const note = timer.kind;
  const results: QuestResult[] = [];
  if (first >= 0.5) results.push(await logMetric('leisure', Math.round(first), { date: startDate, mode: 'add', note, source: 'timer' }));
  if (second >= 0.5 && nextDate <= clock.today()) results.push(await logMetric('leisure', Math.round(second), { date: nextDate, mode: 'add', note, source: 'timer' }));
  return {
    events: [...events, ...results.flatMap((r) => r.events)],
    features: results.flatMap((r) => r.features),
    minutes: Math.round(first + second),
  };
}

// ——— Meals ———

export type MealInput = Omit<Meal, 'id' | 'ts' | 'date'> & { date?: ISODate; ts?: number };

const MACROS: [MetricType, keyof Pick<Meal, 'kcal' | 'protein' | 'carbs' | 'fat'>][] = [
  ['calories', 'kcal'],
  ['protein', 'protein'],
  ['carbs', 'carbs'],
  ['fat', 'fat'],
];

/** Log a meal: stored with its items/photo, and its macros feed the daily metrics (and quests). */
export async function logMeal(input: MealInput): Promise<QuestResult> {
  const date = input.date ?? clock.today();
  const { ts, ...rest } = input;
  const meal: Meal = { ...rest, id: uid('meal_'), ts: ts ?? clock.now(), date };
  await statsRepository.putMeal(meal);
  const events: QuestResult['events'] = [];
  const features: string[] = [];
  for (const [type, key] of MACROS) {
    const v = Math.round(meal[key]);
    if (v <= 0) continue;
    const r = await logMetric(type, v, { date, mode: 'add', note: meal.name, refId: meal.id });
    events.push(...r.events);
    features.push(...r.features);
  }
  return { events, features };
}

/**
 * Edit a logged meal (name, meal, time, values). Its metric entries are changed in place and
 * the day's totals and nutrition quests re-synced, so an edit never grants a second reward.
 */
export function updateMeal(meal: Meal, patch: Partial<Pick<Meal, 'name' | 'mealType' | 'ts' | 'kcal' | 'protein' | 'carbs' | 'fat'>>): Promise<QuestResult> {
  return withTransaction(async () => {
    const next: Meal = { ...meal, ...patch };
    if (meal.items.length === 1) next.items = [{ ...meal.items[0], name: next.name, kcal: next.kcal, protein: next.protein, carbs: next.carbs, fat: next.fat }];
    else if (patch.kcal !== undefined || patch.protein !== undefined || patch.carbs !== undefined || patch.fat !== undefined) next.estimate = meal.estimate ? { ...meal.estimate, edited: true } : undefined;
    await statsRepository.putMeal(next);
    const tx = await GameTx.open(meal.date);
    const existing = await statsRepository.metricsByRef(meal.id);
    for (const [type, key] of MACROS) {
      const v = Math.round(next[key]);
      const entry = existing.find((m) => m.type === type);
      if (entry) {
        if (v > 0) await statsRepository.addMetric({ ...entry, value: v, note: next.name });
        else await statsRepository.removeMetric(entry.id);
      } else if (v > 0) {
        await statsRepository.addMetric({ id: uid('m_'), date: meal.date, type, value: v, ts: next.ts, note: next.name, source: 'manual', refId: meal.id });
      }
    }
    const after = aggregateMetrics(await statsRepository.metricsByDate(meal.date));
    tx.log.metrics = after;
    if (!tx.log.closed) {
      for (const [type] of MACROS) await syncMetricQuests(tx, type, after[type] ?? 0);
      await settleDay(tx);
    }
    await tx.commit();
    return { events: tx.events, features: tx.unlockedFeatures };
  });
}

export async function deleteMeal(meal: Meal): Promise<QuestResult> {
  const events: QuestResult['events'] = [];
  for (const m of await statsRepository.metricsByRef(meal.id)) events.push(...(await deleteMetric(m)).events);
  await statsRepository.removeMeal(meal.id);
  return { events, features: [] };
}
