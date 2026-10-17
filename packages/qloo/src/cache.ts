export function cacheKey(params: unknown): string {
  return JSON.stringify(params);
}

export interface TtlCache<T = unknown> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
  readonly size: number;
}

export function createTtlCache<T = unknown>(ttlMs: number): TtlCache<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      if (ttlMs <= 0) return;
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
