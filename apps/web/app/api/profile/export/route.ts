import { currentViewer } from "@/lib/server/auth/viewer";
import { memoryProfileStore } from "@/lib/server/chat/store";
import { getDb } from "@/lib/server/db";

/** Full account export as a JSON download (§6: export at any time). */
export async function GET(): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const db = getDb();
  const payload =
    viewer.persisted && db
      ? await db.profile.export(viewer.userId)
      : {
          user: { id: viewer.userId, email: viewer.email },
          profile: { version: 2 as const, entries: (await memoryProfileStore(viewer.userId).load()).entries },
          activity: [],
          sites: [],
        };
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="focal-export.json"',
      "cache-control": "no-store",
    },
  });
}
