import { undoEvent, ProfileError, type ActivityEvent } from "@focal-ai/core";
import { DbError } from "@focal-ai/db";
import { caller } from "@/lib/server/auth/caller";
import { dbProfileStore } from "@/lib/server/chat/store";
import { getDb } from "@/lib/server/db";
import { checkRateLimit } from "@/lib/server/rateLimit";

const RATE_LIMIT = { limit: 30, windowMs: 60000 };

function notFound(message: string): Response {
  return Response.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
}

/**
 * One undo endpoint per §4.2. Cookie callers undo their own activity;
 * bearer (extension) callers may only undo `page`-actor events — the
 * extension's feedback undo and nothing else.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const who = await caller(req);
  if (!who) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`activity-undo:${who.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many undo requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  const { id } = await ctx.params;
  const db = getDb();
  if (!(who.persisted && db)) return notFound("No change with that id");
  const record = await db.profile.event(who.userId, id);
  if (!record || record.undoneBy || record.action === "undo") return notFound("No undoable change with that id");
  if (who.via === "bearer" && record.actor !== "page") return notFound("No undoable change with that id");
  if (await db.profile.hasLaterChange(who.userId, record.entryId, record.seq)) {
    return Response.json(
      { error: { code: "CONFLICT", message: "A later change to this entry exists; undo that first" } },
      { status: 409 },
    );
  }
  const store = dbProfileStore(db, who.userId);
  try {
    const profile = await store.load();
    const write = undoEvent(profile, record as ActivityEvent, who.via === "bearer" ? "page" : "manual");
    if (!write.event) return Response.json({ undone: true, eventId: null });
    await store.commit(write.profile, write.event);
    return Response.json({ undone: true, eventId: write.event.id });
  } catch (e) {
    if (e instanceof DbError && e.code === "CONFLICT") {
      return Response.json(
        { error: { code: "CONFLICT", message: "A later change to this entry exists; undo that first" } },
        { status: 409 },
      );
    }
    if (e instanceof ProfileError) return notFound(e.message);
    throw e;
  }
}
