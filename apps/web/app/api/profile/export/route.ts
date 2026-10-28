import { DbError } from "@focal-ai/db";
import { errorResponse } from "@/lib/server/errors";
import { currentViewer } from "@/lib/server/auth/viewer";
import { memoryProfileStore } from "@/lib/server/chat/store";
import { getDb } from "@/lib/server/db";
import { checkRateLimit } from "@/lib/server/rateLimit";

/** Full account export as a JSON download (§6: export at any time). */
export async function GET(): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`export:${viewer.userId}`, { limit: 5, windowMs: 60000 });
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many exports" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  const db = getDb();
  let payload;
  try {
    payload =
      viewer.persisted && db
        ? await db.profile.export(viewer.userId)
        : {
            user: { id: viewer.userId, email: viewer.email },
            profile: { version: 2 as const, entries: (await memoryProfileStore(viewer.userId).load()).entries },
            activity: [],
            sites: [],
          };
  } catch (e) {
    if (e instanceof DbError) return errorResponse(e);
    throw e;
  }
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="focal-export.json"',
      "cache-control": "no-store",
    },
  });
}
