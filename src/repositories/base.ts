import type { Table } from 'dexie';

/** Generic CRUD contract every repository exposes. */
export interface CrudRepository<T, K = string> {
  get(id: K): Promise<T | undefined>;
  all(): Promise<T[]>;
  put(item: T): Promise<void>;
  bulkPut(items: T[]): Promise<void>;
  remove(id: K): Promise<void>;
  clear(): Promise<void>;
}

export function crud<T, K extends string = string>(table: () => Table<T, K>): CrudRepository<T, K> {
  return {
    get: (id) => table().get(id),
    all: () => table().toArray(),
    put: async (item) => {
      await table().put(item);
    },
    bulkPut: async (items) => {
      await table().bulkPut(items);
    },
    remove: (id) => table().delete(id),
    clear: () => table().clear(),
  };
}
