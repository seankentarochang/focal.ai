import { z } from "zod";
import { PagePipelineError, type InsightType, type ProfileV2 } from "@focal-ai/core";
import { errorResponse } from "@/lib/server/errors";
import { rankPage } from "@/lib/server/page/rank";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";

/** Playground budget: no account, so per-IP rather than per-user. */
const RATE_LIMIT = { limit: 30, windowMs: 60000 };

const SHORT_TYPES = ["place", "destination", "artist", "book", "brand", "movie", "person", "podcast", "tv_show", "videogame"] as const;

const bodySchema = z.object({
  pageType: z.string().min(1).max(60),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        city: z.string().trim().min(1).max(80).optional(),
      }),
    )
    .min(1)
    .max(60),
  seeds: z
    .array(
      z.object({
        entityId: z.string().min(1).max(120),
        name: z.string().min(1).max(120),
        subtype: z.string().max(60).optional(),
        strength: z.enum(["love", "like", "dislike"]).optional(),
        polarity: z.enum(["like", "dislike"]).optional(),
      }),
    )
    .max(60)
    .default([]),
});

function toProfile(seeds: z.infer<typeof bodySchema>["seeds"], fallbackType: InsightType): ProfileV2 {
  const now = new Date().toISOString();
  return {
    version: 2,
    updatedAt: now,
    entries: seeds.map((seed) => ({
      id: `seed:${seed.entityId}`,
      kind: "thing" as const,
      qlooId: seed.entityId,
      name: seed.name,
      type: (seed.subtype ?? fallbackType) as InsightType,
      strength: seed.strength ?? (seed.polarity === "dislike" ? ("dislike" as const) : ("like" as const)),
      source: "manual" as const,
      createdAt: now,
    })),
  };
}

/**
 * No-account rank for the /try playground (W-04): turns the page's local
 * seeds into a transient profile and runs the same lift-only pipeline as
 * /api/page/rank, so playground output matches the extension's rules.
 */
export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const limit = checkRateLimit(clientKey(req), RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many requests" } },
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

  const pageType = parsed.data.pageType.replace(/^urn:entity:/, "");
  if (!(SHORT_TYPES as readonly string[]).includes(pageType)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "unknown page type" } }, { status: 400 });
  }
  const insightType = `urn:entity:${pageType}` as InsightType;
  const items = parsed.data.items.map((item, i) => ({
    clientId: `c${i}`,
    name: item.name,
    type: pageType as (typeof SHORT_TYPES)[number],
    ...(item.city ? { city: item.city } : {}),
  }));

  try {
    const result = await rankPage(
      { host: "playground", pathPattern: "/try", pageType: pageType as never, items },
      toProfile(parsed.data.seeds, insightType),
      `try-${crypto.randomUUID()}`,
    );
    return Response.json({
      status: result.status,
      items: result.items,
      plan: result.plan,
      mock: process.env.QLOO_MOCK === "1",
      meta: { durationMs: Date.now() - startedAt },
    });
  } catch (e) {
    if (e instanceof PagePipelineError) {
      return Response.json({ error: { code: e.code, message: "could not build a valid plan" } }, { status: 500 });
    }
    return errorResponse(e);
  }
}
