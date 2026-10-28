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
    throw new DbError("CONFLICT", "ACCOUNT_CONFLICT: an account with this email already exists and is not verified");
  }
  // Confirm the WorkOS user still exists before creating a row — otherwise a
  // deleted identity resurrects a fresh account on its next sign-in.
  if (process.env.WORKOS_API_KEY) {
    const { WorkOS } = await import("@workos-inc/node");
    const remote = await new WorkOS(process.env.WORKOS_API_KEY).userManagement.getUser(user.id).catch(() => null);
    if (!remote) {
      throw new DbError("CONFLICT", "ACCOUNT_CONFLICT: the WorkOS user no longer exists");
    }
  }
  return db.users.upsert(user.email, { workos: user.id });
}
