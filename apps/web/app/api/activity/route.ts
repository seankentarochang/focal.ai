import { currentViewer } from "@/lib/server/auth/viewer";
import { getDb } from "@/lib/server/db";

const LIMIT = 50;

/** Activity feed for the signed-in user, paged by ?before=<event at>. */
export async function GET(req: Request): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const db = getDb();
  if (!(viewer.persisted && db)) return Response.json({ activity: [] });
  const before = new URL(req.url).searchParams.get("before") ?? undefined;
  const activity = await db.profile.activity(viewer.userId, { limit: LIMIT, ...(before ? { before } : {}) });
  return Response.json({ activity });
}
