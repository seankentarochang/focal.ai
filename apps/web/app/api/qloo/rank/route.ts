import {
  buildReason,
  planRender,
  rankCandidates,
  resolveCandidates,
  validatePlan,
  type RankedCandidate,
} from "@focal-ai/core";
import type { QlooEntityType } from "@focal-ai/qloo";
import { toCandidateScores, toCoreSearchFn } from "@/lib/server/adapters";
import { errorResponse } from "@/lib/server/errors";
import { dataSource, getQlooClient } from "@/lib/server/qloo";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";
import { rankBodySchema } from "@/lib/server/schemas";

const RATE_LIMIT = { limit: 20, windowMs: 60000 };
const NO_POSITIVE_SEEDS_MESSAGE = "Add at least one positive taste seed before ranking.";

function invalidBodyResponse(): Response {
  return Response.json(
    { error: { code: "BAD_REQUEST", message: "invalid request body" } },
    { status: 400 },
  );
}

function planValidationFailedResponse(): Response {
  return Response.json(
    { error: { code: "INTERNAL", message: "plan validation failed" } },
    { status: 500 },
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

  const seeds = profile.seeds.filter((seed) => seed.polarity === "like").slice(0, 20);
  if (seeds.length === 0) {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: NO_POSITIVE_SEEDS_MESSAGE } },
      { status: 400 },
    );
  }

  try {
    const client = getQlooClient();
    const resolved = await resolveCandidates(candidates, toCoreSearchFn(client, 3), pageType, {
      location: locationQuery,
    });

    const resolvedIds = resolved.flatMap((candidate) =>
      candidate.status === "resolved" && candidate.entity !== undefined
        ? [candidate.entity.entityId]
        : [],
    );

    if (resolvedIds.length === 0) {
      const ranked = rankCandidates({ candidates: resolved, scores: [], profile });
      const plan = planRender({ pageId, ranked, options: { containerId } });
      if (!validatePlan(plan).ok) return planValidationFailedResponse();
      return Response.json({
        ranked,
        plan,
        meta: {
          dataSource: dataSource(),
          durationMs: Date.now() - startedAt,
          unresolved: candidates.length,
          qlooRequest: { path: "/v2/insights", params: {} },
        },
      });
    }

    const take = Math.min(50, Math.max(20, resolvedIds.length));
    const params: Record<string, string> = {
      "filter.type": pageType,
      "signal.interests.entities": seeds.map((seed) => seed.entityId).join(","),
      "filter.results.entities": resolvedIds.join(","),
    };
    if (locationQuery !== undefined) params["filter.location.query"] = locationQuery;
    params["feature.explainability"] = "true";
    params["take"] = String(take);

    const insights = await client.insights({
      resultType: pageType as QlooEntityType,
      signalEntityIds: seeds.map((seed) => seed.entityId),
      resultEntityIds: resolvedIds,
      locationQuery,
      explainability: true,
      take,
    });

    const scores = toCandidateScores(insights.entities);
    const ranked = rankCandidates({ candidates: resolved, scores, profile }).map((entry) =>
      entry.status === "resolved" && entry.affinity !== undefined
        ? { ...entry, reason: buildReason(entry, profile) as RankedCandidate["reason"] }
        : entry,
    );

    const plan = planRender({
      pageId,
      ranked,
      options: {
        containerId: containerId ?? "focal:results",
        annotate: true,
        collapseSponsored: true,
        emphasizeThreshold: 85,
      },
    });

    if (!validatePlan(plan).ok) return planValidationFailedResponse();

    const unresolved = ranked.filter((entry) => entry.status === "unresolved").length;

    return Response.json({
      ranked,
      plan,
      meta: {
        dataSource: dataSource(),
        durationMs: Date.now() - startedAt,
        unresolved,
        qlooRequest: { path: "/v2/insights", params },
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
