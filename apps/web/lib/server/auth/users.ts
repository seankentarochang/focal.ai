import { DbError, type Db } from "@focal-ai/db";

export interface AuthUser {
  id: string;
  email: string;
  emailVerified?: boolean;
}

/** Only a 404 (or the SDK's entity_not_found) proves a WorkOS user is gone. */
export function workosGone(e: unknown): boolean {
  return (e as { status?: number }).status === 404 || (e as { code?: string }).code === "entity_not_found";
}

/** Maps a WorkOS user onto our users table (one row per email). */
export async function ensureUser(db: Db, user: AuthUser, opts?: { workosVerified?: boolean }) {
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
  if (process.env.WORKOS_API_KEY && !opts?.workosVerified) {
    const { WorkOS } = await import("@workos-inc/node");
    // Only a 404 proves the WorkOS user is gone; any other error must surface.
    const remote = await new WorkOS(process.env.WORKOS_API_KEY).userManagement.getUser(user.id).catch((e: unknown) => {
      if (workosGone(e)) return null;
      throw e;
    });
    if (!remote) {
      throw new DbError("CONFLICT", "ACCOUNT_CONFLICT: the WorkOS user no longer exists");
    }
  }
  return db.users.upsert(user.email, { workos: user.id });
}
