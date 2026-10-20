import { createHash, randomBytes } from "node:crypto";
import { toIso, type Sql } from "./client";

export const EXTENSION_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry: a session used within its lifetime is extended by this much. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface ExtensionSession {
  id: string;
  userId: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

const from = (r: Record<string, unknown>): ExtensionSession => ({
  id: r.id as string,
  userId: r.user_id as string,
  createdAt: toIso(r.created_at as Date)!,
  lastUsedAt: toIso(r.last_used_at as Date)!,
  expiresAt: toIso(r.expires_at as Date)!,
});

export function extensionSessionsRepo(sql: Sql) {
  return {
    /** Issues a new token. The plaintext is returned once and never stored. */
    async issue(userId: string, ttlMs = EXTENSION_SESSION_TTL_MS): Promise<{ token: string; session: ExtensionSession }> {
      const token = `fx_${randomBytes(32).toString("base64url")}`;
      const [row] = await sql`
        INSERT INTO extension_sessions (user_id, token_hash, expires_at)
        VALUES (${userId}, ${hashToken(token)}, ${new Date(Date.now() + ttlMs).toISOString()})
        RETURNING *`;
      return { token, session: from(row!) };
    },

    /** Resolves a live token; refreshes last-used and slides the expiry at most hourly. */
    async resolve(token: string, ttlMs = EXTENSION_SESSION_TTL_MS): Promise<ExtensionSession | null> {
      const [row] = await sql`
        SELECT * FROM extension_sessions
        WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL AND expires_at > now()`;
      if (!row) return null;
      const session = from(row);
      if (Date.now() - Date.parse(session.lastUsedAt) > TOUCH_INTERVAL_MS) {
        const expires = new Date(Date.now() + ttlMs).toISOString();
        await sql`UPDATE extension_sessions SET last_used_at = now(), expires_at = ${expires} WHERE id = ${session.id}`;
        return { ...session, lastUsedAt: new Date().toISOString(), expiresAt: expires };
      }
      return session;
    },

    async revoke(token: string): Promise<boolean> {
      const rows = await sql`
        UPDATE extension_sessions SET revoked_at = now()
        WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL RETURNING id`;
      return rows.length > 0;
    },

    async revokeAll(userId: string): Promise<number> {
      const rows = await sql`
        UPDATE extension_sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
      return rows.length;
    },
  };
}
