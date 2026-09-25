import type { Activity, Routine } from '@/types';
import { crud, type CrudRepository } from './base';
import { getDb } from './db';

export interface ActivityRepository extends CrudRepository<Activity> {
  active(): Promise<Activity[]>;
}

export const activityRepository: ActivityRepository = {
  ...crud(() => getDb().activities),
  active: async () => (await getDb().activities.toArray()).filter((a) => a.active),
};

export type RoutineRepository = CrudRepository<Routine>;

export const routineRepository: RoutineRepository = crud(() => getDb().routines);
