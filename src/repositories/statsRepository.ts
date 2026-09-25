import type { DayLog, DayPlan, ISODate, LedgerEntry, MetricEntry, MetricType, PersonalRecord } from '@/types';
import { getDb } from './db';

/** Metrics summed per day; the others keep the latest value. */
export const SUM_METRICS: MetricType[] = ['water', 'calories', 'protein', 'carbs', 'fat', 'distance', 'activeCalories', 'workoutMinutes', 'leisure'];

export interface StatsRepository {
  getLog(date: ISODate): Promise<DayLog | undefined>;
  putLog(log: DayLog): Promise<void>;
  logs(from: ISODate, to: ISODate): Promise<DayLog[]>;
  allLogs(): Promise<DayLog[]>;

  getPlan(date: ISODate): Promise<DayPlan | undefined>;
  putPlan(plan: DayPlan): Promise<void>;
  removePlan(date: ISODate): Promise<void>;

  addMetric(entry: MetricEntry): Promise<void>;
  removeMetric(id: string): Promise<void>;
  metricsByDate(date: ISODate): Promise<MetricEntry[]>;
  metricsRange(from: ISODate, to: ISODate): Promise<MetricEntry[]>;
  metricsOfType(type: MetricType, from: ISODate, to: ISODate): Promise<MetricEntry[]>;

  counters(): Promise<Record<string, number>>;
  incrementCounters(inc: Record<string, number>): Promise<void>;
  setCounters(values: Record<string, number>): Promise<void>;

  records(): Promise<PersonalRecord[]>;
  putRecords(records: PersonalRecord[]): Promise<void>;

  addLedger(entries: LedgerEntry[]): Promise<void>;
  ledger(from: ISODate, to: ISODate): Promise<LedgerEntry[]>;
}

export const statsRepository: StatsRepository = {
  getLog: (date) => getDb().dayLogs.get(date),
  putLog: async (log) => {
    await getDb().dayLogs.put(log);
  },
  logs: (from, to) => getDb().dayLogs.where('date').between(from, to, true, true).toArray(),
  allLogs: () => getDb().dayLogs.toArray(),

  getPlan: (date) => getDb().dayPlans.get(date),
  putPlan: async (plan) => {
    await getDb().dayPlans.put(plan);
  },
  removePlan: (date) => getDb().dayPlans.delete(date),

  addMetric: async (entry) => {
    await getDb().metrics.put(entry);
  },
  removeMetric: (id) => getDb().metrics.delete(id),
  metricsByDate: (date) => getDb().metrics.where('date').equals(date).toArray(),
  metricsRange: (from, to) => getDb().metrics.where('date').between(from, to, true, true).toArray(),
  metricsOfType: (type, from, to) =>
    getDb().metrics.where('[type+date]').between([type, from], [type, to], true, true).toArray(),

  counters: async () => {
    const out: Record<string, number> = {};
    for (const c of await getDb().counters.toArray()) out[c.key] = c.value;
    return out;
  },
  incrementCounters: async (inc) => {
    const keys = Object.keys(inc);
    if (!keys.length) return;
    const table = getDb().counters;
    const existing = await table.bulkGet(keys);
    await table.bulkPut(keys.map((key, i) => ({ key, value: (existing[i]?.value ?? 0) + inc[key] })));
  },
  setCounters: async (values) => {
    const keys = Object.keys(values);
    if (!keys.length) return;
    await getDb().counters.bulkPut(keys.map((key) => ({ key, value: values[key] })));
  },

  records: () => getDb().records.toArray(),
  putRecords: async (records) => {
    if (records.length) await getDb().records.bulkPut(records);
  },

  addLedger: async (entries) => {
    if (entries.length) await getDb().ledger.bulkPut(entries);
  },
  ledger: (from, to) => getDb().ledger.where('date').between(from, to, true, true).toArray(),
};

/** Aggregate metric entries into daily values. */
export function aggregateMetrics(entries: MetricEntry[]): Partial<Record<MetricType, number>> {
  const out: Partial<Record<MetricType, number>> = {};
  const latest: Partial<Record<MetricType, number>> = {};
  for (const e of entries) {
    if (SUM_METRICS.includes(e.type)) out[e.type] = (out[e.type] ?? 0) + e.value;
    else if ((latest[e.type] ?? -1) <= e.ts) {
      latest[e.type] = e.ts;
      out[e.type] = e.value;
    }
  }
  return out;
}

export function metricsByDay(entries: MetricEntry[]): Record<ISODate, Partial<Record<MetricType, number>>> {
  const grouped: Record<ISODate, MetricEntry[]> = {};
  for (const e of entries) (grouped[e.date] ??= []).push(e);
  const out: Record<ISODate, Partial<Record<MetricType, number>>> = {};
  for (const [date, list] of Object.entries(grouped)) out[date] = aggregateMetrics(list);
  return out;
}
