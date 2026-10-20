import { createEmptyProfileV2, type ActivityEvent, type ProfileV2 } from "@focal-ai/core";
import type { Db } from "@focal-ai/db";

export interface ChatProfileStore {
  load(): Promise<ProfileV2>;
  commit(next: ProfileV2, event: ActivityEvent): Promise<void>;
}

/** Postgres-backed: every write is one attributed transaction guarded by the profile version. */
export function dbProfileStore(db: Db, userId: string): ChatProfileStore {
  let version = 0;
  return {
    async load() {
      const loaded = await db.profile.load(userId);
      version = loaded.version;
      return { version: 2, updatedAt: new Date().toISOString(), entries: loaded.entries as unknown as ProfileV2["entries"] };
    },
    async commit(_next, event) {
      version = await db.profile.commit(userId, event as never, version);
    },
  };
}

const memory = new Map<string, ProfileV2>();

/** Dev-only in-process store (FOCAL_DEV_SESSION without a database). */
export function memoryProfileStore(userId: string): ChatProfileStore {
  return {
    async load() {
      return memory.get(userId) ?? createEmptyProfileV2();
    },
    async commit(next) {
      memory.set(userId, next);
    },
  };
}
