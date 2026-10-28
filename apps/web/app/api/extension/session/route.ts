import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";
import { ensureUser } from "@/lib/server/auth/users";
import { getDb } from "@/lib/server/db";
import { bearer } from "@/lib/server/page/session";
import { checkRateLimit } from "@/lib/server/rateLimit";

function unavailable(): Response {
  return Response.json({ error: { code: "NOT_CONFIGURED", message: "database is not configured" } }, { status: 503 });
}

/**
 * Issues the extension a session token for the signed-in website user. The
 * /connect page passes it to the extension over externally_connectable.
 */
export async function POST(): Promise<Response> {
  if (!authEnabled()) return authDisabledResponse();
  const db = getDb();
  if (!db) return unavailable();
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (!user?.email) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`ext-session:${user.id}`, { limit: 10, windowMs: 60000 });
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many session requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  const account = await ensureUser(db, { id: user.id, email: user.email, emailVerified: user.emailVerified === true });
  const { token, session } = await db.extensionSessions.issue(account.id);
  return Response.json({ token, email: account.email, expiresAt: session.expiresAt }, { headers: { "Cache-Control": "no-store" } });
}

/** Extension sign-out: revokes the presented token. */
export async function DELETE(req: Request): Promise<Response> {
  const db = getDb();
  if (!db) return unavailable();
  const token = bearer(req);
  if (token) await db.extensionSessions.revoke(token);
  return new Response(null, { status: 204 });
}
