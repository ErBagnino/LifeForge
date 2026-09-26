import Dexie, { type Table } from 'dexie';
import { APP_CONFIG } from '@/config/app';
import type {
  Achievement,
  Activity,
  AiChange,
  AiUsageRecord,
  Building,
  Cosmetic,
  CounterEntry,
  DayLog,
  DayPlan,
  Exercise,
  ExerciseState,
  LedgerEntry,
  Meal,
  MetaEntry,
  MetricEntry,
  NotificationRecord,
  PersonalRecord,
  Player,
  Quest,
  RealReward,
  RewardRedemption,
  Routine,
  Settings,
  Suggestion,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

/**
 * The only module that knows about Dexie/IndexedDB. Everything else goes through
 * repositories, so a sync layer or another store can replace this later.
 */
export class LifeForgeDB extends Dexie {
  meta!: Table<MetaEntry, string>;
  player!: Table<Player, string>;
  settings!: Table<Settings, string>;
  activities!: Table<Activity, string>;
  routines!: Table<Routine, string>;
  quests!: Table<Quest, string>;
  dayLogs!: Table<DayLog, string>;
  dayPlans!: Table<DayPlan, string>;
  metrics!: Table<MetricEntry, string>;
  exercises!: Table<Exercise, string>;
  plans!: Table<WorkoutPlan, string>;
  sessions!: Table<WorkoutSession, string>;
  exerciseStates!: Table<ExerciseState, string>;
  achievements!: Table<Achievement, string>;
  records!: Table<PersonalRecord, string>;
  counters!: Table<CounterEntry, string>;
  buildings!: Table<Building, string>;
  cosmetics!: Table<Cosmetic, string>;
  rewards!: Table<RealReward, string>;
  redemptions!: Table<RewardRedemption, string>;
  suggestions!: Table<Suggestion, string>;
  notifications!: Table<NotificationRecord, string>;
  ledger!: Table<LedgerEntry, string>;
  meals!: Table<Meal, string>;
  aiUsage!: Table<AiUsageRecord, string>;
  aiChanges!: Table<AiChange, string>;

  constructor(name: string = APP_CONFIG.dbName) {
    super(name);
    this.version(1).stores({
      meta: 'key',
      player: 'id',
      settings: 'id',
      activities: 'id, category, tier, active',
      routines: 'id',
      quests: 'id, date, endDate, kind, status, activityId, [date+kind], [activityId+date]',
      dayLogs: 'date',
      dayPlans: 'date',
      metrics: 'id, date, type, [date+type], [type+date]',
      exercises: 'id',
      plans: 'id',
      sessions: 'id, date, status, templateId',
      exerciseStates: 'exerciseId',
      achievements: 'id, category, unlockedAt',
      records: 'id, kind',
      counters: 'key',
      buildings: 'id',
      cosmetics: 'id, type',
      rewards: 'id',
      redemptions: 'id, ts',
      suggestions: 'id, key, status, type',
      notifications: 'id, scheduledAt, tag, status',
      ledger: 'id, date, ts',
    });
    // v2: meals (food log with optional photo); metrics gain a meal reference.
    this.version(2).stores({
      meals: 'id, date, ts',
      metrics: 'id, date, type, refId, [date+type], [type+date]',
    });
    // v3: local Gemini usage log (metadata only) and the Coach change log (undo).
    this.version(3).stores({
      aiUsage: 'id, ts, type',
      aiChanges: 'id, ts',
    });
  }
}

let instance: LifeForgeDB | null = null;

export function getDb(): LifeForgeDB {
  if (!instance) instance = new LifeForgeDB();
  return instance;
}

/** Tests use this to get a fresh database. */
export function resetDbInstance(name?: string): LifeForgeDB {
  instance?.close();
  instance = new LifeForgeDB(name);
  return instance;
}

/** Run a function atomically across all tables (all-or-nothing writes). */
export function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction('rw', db.tables, fn);
}

export const TABLE_NAMES = [
  'meta',
  'player',
  'settings',
  'activities',
  'routines',
  'quests',
  'dayLogs',
  'dayPlans',
  'metrics',
  'exercises',
  'plans',
  'sessions',
  'exerciseStates',
  'achievements',
  'records',
  'counters',
  'buildings',
  'cosmetics',
  'rewards',
  'redemptions',
  'suggestions',
  'notifications',
  'ledger',
  'meals',
  'aiUsage',
  'aiChanges',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];
