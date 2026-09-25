import type { NotificationRecord } from '@/types';
import { getDb } from './db';

export interface NotificationRepository {
  add(n: NotificationRecord): Promise<void>;
  update(n: NotificationRecord): Promise<void>;
  between(fromTs: number, toTs: number): Promise<NotificationRecord[]>;
  recent(limit: number): Promise<NotificationRecord[]>;
  pruneBefore(ts: number): Promise<void>;
}

export const notificationRepository: NotificationRepository = {
  add: async (n) => {
    await getDb().notifications.put(n);
  },
  update: async (n) => {
    await getDb().notifications.put(n);
  },
  between: (fromTs, toTs) => getDb().notifications.where('scheduledAt').between(fromTs, toTs, true, true).toArray(),
  recent: (limit) => getDb().notifications.orderBy('scheduledAt').reverse().limit(limit).toArray(),
  pruneBefore: async (ts) => {
    await getDb().notifications.where('scheduledAt').below(ts).delete();
  },
};
