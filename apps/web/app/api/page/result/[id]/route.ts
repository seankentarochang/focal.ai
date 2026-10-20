import { resolveSession, unauthorizedResponse } from "@/lib/server/page/session";
import { getPageResultStore } from "@/lib/server/page/store";

/** Backs "Why this order?": only the owner, only for 24 h. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await resolveSession(req);
  if (!session) return unauthorizedResponse();
  const { id } = await ctx.params;
  const row = await getPageResultStore().get(id, session.userId);
  if (!row) return Response.json({ error: { code: "NOT_FOUND", message: "page result not found or expired" } }, { status: 404 });
  return Response.json(row);
}
