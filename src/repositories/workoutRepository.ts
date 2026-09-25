import type { Exercise, ExerciseState, ISODate, WorkoutPlan, WorkoutSession } from '@/types';
import { crud, type CrudRepository } from './base';
import { getDb } from './db';

export interface WorkoutRepository {
  exercises: CrudRepository<Exercise>;
  plans: CrudRepository<WorkoutPlan>;
  states: CrudRepository<ExerciseState>;
  activePlan(): Promise<WorkoutPlan | undefined>;
  getSession(id: string): Promise<WorkoutSession | undefined>;
  putSession(s: WorkoutSession): Promise<void>;
  removeSession(id: string): Promise<void>;
  activeSession(): Promise<WorkoutSession | undefined>;
  sessionsRange(from: ISODate, to: ISODate): Promise<WorkoutSession[]>;
  recentSessions(limit: number): Promise<WorkoutSession[]>;
  allSessions(): Promise<WorkoutSession[]>;
}

export const workoutRepository: WorkoutRepository = {
  exercises: crud(() => getDb().exercises),
  plans: crud(() => getDb().plans),
  states: crud(() => getDb().exerciseStates),
  activePlan: async () => (await getDb().plans.toArray()).find((p) => p.active),
  getSession: (id) => getDb().sessions.get(id),
  putSession: async (s) => {
    await getDb().sessions.put(s);
  },
  removeSession: (id) => getDb().sessions.delete(id),
  activeSession: async () => (await getDb().sessions.where('status').equals('active').toArray())[0],
  sessionsRange: (from, to) => getDb().sessions.where('date').between(from, to, true, true).toArray(),
  recentSessions: async (limit) => (await getDb().sessions.orderBy('date').reverse().limit(limit * 2).toArray()).filter((s) => s.status === 'completed').slice(0, limit),
  allSessions: () => getDb().sessions.toArray(),
};
