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

/**
 * In-process store with the 24 h expiry; swapped for @focal-ai/db's
 * pageResults repo once the database is wired into the web app.
 */
export function createMemoryPageResultStore(ttlMs = PAGE_RESULT_TTL_MS, max = 5000): PageResultStore {
  const rows = new Map<string, StoredPageResult>();
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

let store: PageResultStore | undefined;

export function getPageResultStore(): PageResultStore {
  store ??= createMemoryPageResultStore();
  return store;
}

export function __setPageResultStoreForTests(s: PageResultStore | undefined): void {
  store = s;
}
