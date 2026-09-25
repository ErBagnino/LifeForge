import type { Building, Cosmetic, RealReward, RewardRedemption } from '@/types';
import { crud, type CrudRepository } from './base';
import { getDb } from './db';

export interface TycoonRepository {
  buildings: CrudRepository<Building>;
  cosmetics: CrudRepository<Cosmetic>;
  rewards: CrudRepository<RealReward>;
  addRedemption(r: RewardRedemption): Promise<void>;
  redemptions(): Promise<RewardRedemption[]>;
}

export const tycoonRepository: TycoonRepository = {
  buildings: crud(() => getDb().buildings),
  cosmetics: crud(() => getDb().cosmetics),
  rewards: crud(() => getDb().rewards),
  addRedemption: async (r) => {
    await getDb().redemptions.put(r);
  },
  redemptions: () => getDb().redemptions.orderBy('ts').reverse().toArray(),
};
