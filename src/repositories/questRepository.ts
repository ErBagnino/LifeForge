import Dexie from 'dexie';
import type { ISODate, Quest } from '@/types';
import { crud, type CrudRepository } from './base';
import { getDb } from './db';

export interface QuestRepository extends CrudRepository<Quest> {
  byDate(date: ISODate): Promise<Quest[]>;
  byRange(from: ISODate, to: ISODate): Promise<Quest[]>;
  /** Weekly/boss quests whose window contains the date. */
  longActive(date: ISODate): Promise<Quest[]>;
  byActivity(activityId: string, since: ISODate): Promise<Quest[]>;
  count(): Promise<number>;
}

export const questRepository: QuestRepository = {
  ...crud(() => getDb().quests),
  byDate: (date) => getDb().quests.where('date').equals(date).toArray(),
  byRange: (from, to) => getDb().quests.where('date').between(from, to, true, true).toArray(),
  longActive: async (date) =>
    (await getDb().quests.where('endDate').aboveOrEqual(date).toArray()).filter((q) => q.date <= date),
  byActivity: (activityId, since) =>
    getDb()
      .quests.where('[activityId+date]')
      .between([activityId, since], [activityId, Dexie.maxKey], true, true)
      .toArray(),
  count: () => getDb().quests.count(),
};
