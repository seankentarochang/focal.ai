import type { Db } from "@focal-ai/db";
import { getDb } from "../db";

export const PAGE_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredPageResult {
  id: string;
  userId: string;
  hostname: string;
  status: string;
  items: unknown;
  plan: unknown;
  meta: unknown;
  createdAt: string;
  expiresAt: string;
}

export interface PageResultStore {
  save(r: Omit<StoredPageResult, "createdAt" | "expiresAt">): Promise<StoredPageResult>;
  get(id: string, userId: string): Promise<StoredPageResult | null>;
}

const memoryRows = new Map<string, StoredPageResult>();

/** Dev delete: drop this user's in-memory page results (R8-4). */
export function clearMemoryPageResults(userId: string): void {
  for (const [id, row] of memoryRows) if (row.userId === userId) memoryRows.delete(id);
}

/** In-process store with the 24 h expiry, used when no database is configured. */
export function createMemoryPageResultStore(ttlMs = PAGE_RESULT_TTL_MS, max = 5000): PageResultStore {
  const rows = memoryRows;
  const live = (r: StoredPageResult) => Date.parse(r.expiresAt) > Date.now();
  return {
    async save(r) {
      const now = Date.now();
      const row = { ...r, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
      rows.set(r.id, row);
      for (const [id, old] of rows) {
        if (rows.size <= max && live(old)) break;
        rows.delete(id);
      }
      return row;
    },
    async get(id, userId) {
      const row = rows.get(id);
      if (!row || row.userId !== userId) return null;
      if (!live(row)) {
        rows.delete(id);
        return null;
      }
      return row;
    },
  };
}

/** Postgres-backed store, so results survive restarts and are shared across instances. */
export function createDbPageResultStore(db: Db): PageResultStore {
  let lastPurge = 0;
  return {
    save: (r) => {
      const now = Date.now();
      if (now - lastPurge > 60 * 60 * 1000) {
        lastPurge = now;
        void db.pageResults.purgeExpired().catch(() => {});
      }
      return db.pageResults.save(r, PAGE_RESULT_TTL_MS);
    },
    get: (id, userId) => db.pageResults.get(id, userId),
  };
}

let store: PageResultStore | undefined;

export function getPageResultStore(): PageResultStore {
  if (store) return store;
  const db = getDb();
  store = db ? createDbPageResultStore(db) : createMemoryPageResultStore();
  return store;
}

export function __setPageResultStoreForTests(s: PageResultStore | undefined): void {
  store = s;
}
