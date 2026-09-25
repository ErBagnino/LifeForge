import type { Achievement, PersonalRecord } from '@/types';
import { crud, type CrudRepository } from './base';
import { getDb } from './db';

export interface AchievementRepository extends CrudRepository<Achievement> {
  unlocked(): Promise<Achievement[]>;
  records(): Promise<PersonalRecord[]>;
}

export const achievementRepository: AchievementRepository = {
  ...crud(() => getDb().achievements),
  unlocked: async () => (await getDb().achievements.toArray()).filter((a) => !!a.unlockedAt),
  records: () => getDb().records.toArray(),
};
