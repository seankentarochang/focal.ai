import { DbError, type Db } from "@focal-ai/db";

export interface AuthUser {
  id: string;
  email: string;
  emailVerified?: boolean;
}

/** Maps a WorkOS user onto our users table (one row per email). */
export async function ensureUser(db: Db, user: AuthUser) {
  const byAuth = await db.users.byAuthId("workos", user.id);
  if (byAuth) return byAuth;
  // A different account with the same email is only claimable when WorkOS has
  // verified this user owns that mailbox — otherwise merging would hand an
  // attacker someone else's profile.
  const byEmail = await db.users.byEmail(user.email);
  if (byEmail && user.emailVerified !== true) {
    throw new DbError("CONFLICT", `account exists for ${user.email} but the email is not verified`);
  }
  return db.users.upsert(user.email, { workos: user.id });
}
