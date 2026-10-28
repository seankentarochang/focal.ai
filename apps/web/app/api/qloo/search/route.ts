import type { QlooEntityType } from "@focal-ai/qloo";
import { errorResponse } from "@/lib/server/errors";
import { dataSource, getQlooClient } from "@/lib/server/qloo";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";
import { searchBodySchema } from "@/lib/server/schemas";

const RATE_LIMIT = { limit: 30, windowMs: 60000 };

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

  const limit = checkRateLimit(`search:${clientKey(req)}`, RATE_LIMIT);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterMs);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return invalidBodyResponse();
  }

  const parsed = searchBodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  try {
    const result = await getQlooClient().search({
      query: parsed.data.query,
      types: parsed.data.types as QlooEntityType[] | undefined,
      location: parsed.data.location,
      take: 8,
    });

    return Response.json({
      entities: result.entities,
      meta: { dataSource: dataSource(), durationMs: Date.now() - startedAt },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
