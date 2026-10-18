import { errorResponse } from "@/lib/server/errors";
import { pageRankErrorResponse, runPageRank, toRankMeta } from "@/lib/server/pipeline";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";
import { rankBodySchema } from "@/lib/server/schemas";

const RATE_LIMIT = { limit: 20, windowMs: 60000 };

function invalidBodyResponse(): Response {
  return Response.json(
    { error: { code: "BAD_REQUEST", message: "invalid request body" } },
    { status: 400 },
  );
}

function rateLimitedResponse(retryAfterMs: number): Response {
  return Response.json(
    {
      error: {
        code: "RATE_LIMIT",
        message: "Too many requests. Please slow down and try again shortly.",
      },
    },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();

  const limit = checkRateLimit(clientKey(req), RATE_LIMIT);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterMs);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return invalidBodyResponse();
  }

  const parsed = rankBodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  const { pageId, pageType, locationQuery, containerId, candidates, profile } = parsed.data;

  try {
    const pipeline = await runPageRank({
      pageId,
      pageType,
      locationQuery,
      containerId,
      candidates,
      profile,
    });

    return Response.json({
      ranked: pipeline.ranked,
      plan: pipeline.plan,
      meta: toRankMeta(pipeline, Date.now() - startedAt),
    });
  } catch (e) {
    const mapped = pageRankErrorResponse(e);
    if (mapped !== undefined) return mapped;
    return errorResponse(e);
  }
}
