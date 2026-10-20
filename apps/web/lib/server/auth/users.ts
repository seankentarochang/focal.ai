import type { Db } from "@focal-ai/db";

export interface AuthUser {
  id: string;
  email: string;
}

/** Maps a WorkOS user onto our users table (one row per email). */
export async function ensureUser(db: Db, user: AuthUser) {
  return db.users.upsert(user.email, { workos: user.id });
}
