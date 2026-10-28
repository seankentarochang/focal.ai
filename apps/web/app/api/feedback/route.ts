import { z } from "zod";
import { DbError } from "@focal-ai/db";
import { addEntry, changeStrength, findEntry, ProfileError, type InsightType } from "@focal-ai/core";
import { errorResponse } from "@/lib/server/errors";
import { dbProfileStore } from "@/lib/server/chat/store";
import { resolveSession, unauthorizedResponse } from "@/lib/server/page/session";
import { getPageResultStore } from "@/lib/server/page/store";
import { checkRateLimit } from "@/lib/server/rateLimit";

const RATE_LIMIT = { limit: 60, windowMs: 60000 };

const bodySchema = z.union([
  z.object({
    pageResultId: z.string().min(1).max(80),
    clientId: z.string().min(1).max(16),
    verdict: z.enum(["more", "less"]),
  }),
]);

function notFound(message: string): Response {
  return Response.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
}

interface ResultItem {
  clientId: string;
  name: string;
  type?: string;
  status?: string;
  entityId?: string;
  entityName?: string;
}

/**
 * On-page feedback (X-08, §5.8): "More like this" writes a like, "Not for me"
 * a dislike, attributed to `page` and undoable like every other write. The
 * entity comes from the stored PageResult, never from the client.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await resolveSession(req);
  if (!session) return unauthorizedResponse();
  const limit = checkRateLimit(`feedback:${session.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many feedback requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  const db = getPageResultStore();
  const { getDb } = await import("@/lib/server/db");
  const conn = getDb();
  if (!conn) {
    return Response.json({ error: { code: "UNAVAILABLE", message: "feedback needs a database" } }, { status: 503 });
  }
  const { pageResultId, clientId, verdict } = parsed.data;
  const result = await db.get(pageResultId, session.userId);
  if (!result) return notFound("No such page result");
  const items = (result.items ?? []) as ResultItem[];
  const item = items.find((i) => i.clientId === clientId);
  if (!item?.entityId || !item.type || item.status !== "resolved") {
    return notFound("That card has no matched thing to rate");
  }

  const strength = verdict === "more" ? "like" : "dislike";
  const store = dbProfileStore(conn, session.userId);
  // One retry on a profile-version conflict; a second means a real race.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const profile = await store.load();
      const v2 = { version: 2 as const, updatedAt: new Date().toISOString(), entries: profile.entries as never };
      const existing = findEntry(v2, "thing", item.entityId);
      if (existing && existing.strength === strength) {
        return Response.json({ saved: true, eventId: null });
      }
      const write = existing
        ? changeStrength(v2, existing.id, strength, "page")
        : addEntry(
            v2,
            {
              kind: "thing",
              qlooId: item.entityId,
              name: item.entityName ?? item.name,
              type: item.type as InsightType,
              strength,
              source: "page",
            },
            "page",
          );
      if (write.event) await store.commit(write.profile, write.event);
      return Response.json({ saved: true, entryId: write.event?.entryId ?? null, eventId: write.event?.id ?? null });
    } catch (e) {
      if (e instanceof DbError && e.code === "CONFLICT") {
        if (attempt === 0) continue;
        return Response.json(
          { error: { code: "CONFLICT", message: "Your profile changed elsewhere; try again." } },
          { status: 409 },
        );
      }
      if (e instanceof ProfileError) return notFound(e.message);
      throw e;
    }
  }
  return notFound("unreachable");
}
