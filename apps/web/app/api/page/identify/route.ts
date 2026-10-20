import { errorResponse } from "@/lib/server/errors";
import { getIdentifier, IdentifyUnavailableError, selectIdentified } from "@/lib/server/page/identify";
import { identifyBodySchema } from "@/lib/server/page/schemas";
import { resolveSession, unauthorizedResponse } from "@/lib/server/page/session";
import { checkRateLimit } from "@/lib/server/rateLimit";

/** Per-user Jev budget: one call per new layout, so this is generous. */
const RATE_LIMIT = { limit: 30, windowMs: 60000 };

export async function POST(req: Request): Promise<Response> {
  const session = await resolveSession(req);
  if (!session) return unauthorizedResponse();
  const limit = checkRateLimit(`identify:${session.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many identify requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = identifyBodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);
  try {
    const answer = await getIdentifier().identify(parsed.data);
    return Response.json(selectIdentified(answer));
  } catch (e) {
    if (e instanceof IdentifyUnavailableError) {
      return Response.json({ error: { code: "UNAVAILABLE", message: e.message } }, { status: 503 });
    }
    return errorResponse(e);
  }
}
