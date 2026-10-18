import type { PageCandidate, ProfileRule, TasteProfile } from "@focal-ai/core";
import { QlooError, type QlooEntityType } from "@focal-ai/qloo";
import { parseIntent } from "@/lib/server/agent/intent";
import type { AgentExplanationItem, AgentResponse, AgentStep } from "@/lib/server/agent/types";
import { errorResponse } from "@/lib/server/errors";
import { pageRankErrorResponse, runPageRank, toRankMeta } from "@/lib/server/pipeline";
import { getQlooClient } from "@/lib/server/qloo";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";
import { agentBodySchema } from "@/lib/server/schemas";

const RATE_LIMIT = { limit: 10, windowMs: 60000 };
const DISCOVERY_TAKE = 6;
const BOOST_RULE_WEIGHT = 1.5;
const MAX_EXPLAIN_ITEMS = 3;
const MAX_PROFILE_RULES = 20;

interface RunAgentInput {
  message: string;
  pageId: string;
  pageType: string;
  locationQuery?: string;
  containerId?: string;
  candidates: PageCandidate[];
  profile: TasteProfile;
  /** Request start, so rank meta durationMs matches the rank route semantics. */
  startedAt: number;
}

function makeStep(tool: string, startedAt: number, status: "ok" | "error", summary: string): AgentStep {
  return { tool, summary, status, durationMs: Date.now() - startedAt };
}

function count(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

type StepOutcome<T> = { ok: true; value: T } | { ok: false; error: QlooError };

/**
 * Runs one agent step. QlooError is a modeled mid-flow failure: it is recorded
 * as an error step and surfaces as result kind "error" with the honest message.
 * Anything else (PageRankError, bugs) propagates: PageRankError is mapped to
 * the frozen 400/500 responses, the rest to errorResponse.
 */
async function runStep<T>(
  steps: AgentStep[],
  tool: string,
  task: () => Promise<T>,
  summarize: (value: T) => string,
): Promise<StepOutcome<T>> {
  const at = Date.now();
  try {
    const value = await task();
    steps.push(makeStep(tool, at, "ok", summarize(value)));
    return { ok: true, value };
  } catch (e) {
    if (e instanceof QlooError) {
      steps.push(makeStep(tool, at, "error", e.message));
      return { ok: false, error: e };
    }
    throw e;
  }
}

function errorResponseFor(steps: AgentStep[], detail: string): AgentResponse {
  return { steps, message: detail, result: { kind: "error", detail } };
}

function describeExplanationItem(item: AgentExplanationItem): string {
  const pct = item.affinityPct !== undefined ? ` at ${item.affinityPct}%` : "";
  const why = item.reason !== undefined ? ` — ${item.reason}` : "";
  return `${item.name}${pct}${why}`;
}

async function runAgent(input: RunAgentInput): Promise<AgentResponse> {
  const client = getQlooClient();
  const steps: AgentStep[] = [];
  const likeSeeds = input.profile.seeds.filter((seed) => seed.polarity === "like");

  const profileAt = Date.now();
  steps.push(
    makeStep(
      "get_taste_profile",
      profileAt,
      "ok",
      `${input.profile.seeds.length} seeds (${likeSeeds.length} positive)`,
    ),
  );

  // An LLM-backed intent parser would slot in here (one tool call returning an
  // AgentIntent); parseIntent is deterministic, offline and free.
  const intent = parseIntent(input.message);

  const pipelineInput = {
    pageId: input.pageId,
    pageType: input.pageType,
    locationQuery: input.locationQuery,
    containerId: input.containerId,
    candidates: input.candidates,
    profile: input.profile,
  };

  switch (intent.kind) {
    case "rank": {
      const outcome = await runStep(
        steps,
        "score_candidates",
        () => runPageRank(pipelineInput),
        (p) =>
          `Ranked ${count(p.ranked.length, "candidate")} (${p.meta.unresolved} unresolved).`,
      );
      if (!outcome.ok) return errorResponseFor(steps, outcome.error.message);

      const pipeline = outcome.value;
      const resolved = pipeline.ranked.filter((entry) => entry.status === "resolved").length;
      return {
        steps,
        message: `Ranked ${count(pipeline.ranked.length, "candidate")} against ${count(
          likeSeeds.length,
          "positive seed",
        )}: ${resolved} resolved.`,
        result: {
          kind: "rank",
          ranked: pipeline.ranked,
          plan: pipeline.plan,
          meta: toRankMeta(pipeline, Date.now() - input.startedAt),
        },
      };
    }

    case "explain": {
      const outcome = await runStep(
        steps,
        "score_candidates",
        () => runPageRank(pipelineInput),
        (p) =>
          `Ranked ${count(p.ranked.length, "candidate")} (${p.meta.unresolved} unresolved).`,
      );
      if (!outcome.ok) return errorResponseFor(steps, outcome.error.message);

      const pipeline = outcome.value;
      const resolvedCount = pipeline.ranked.filter((entry) => entry.status === "resolved").length;
      const items: AgentExplanationItem[] = pipeline.ranked
        .filter((entry) => entry.status === "resolved")
        .slice(0, MAX_EXPLAIN_ITEMS)
        .map((entry) => ({
          name: entry.entity?.name ?? entry.name,
          ...(entry.affinityPct !== undefined ? { affinityPct: entry.affinityPct } : {}),
          ...(entry.reason?.text !== undefined ? { reason: entry.reason.text } : {}),
        }));

      const explainAt = Date.now();
      const summary =
        items.length === 0
          ? "No resolved candidates to explain."
          : `Explained ${count(items.length, "candidate")} of ${resolvedCount} resolved.`;
      steps.push(makeStep("explain_ranking", explainAt, "ok", summary));

      const best = items[0];
      const message =
        best === undefined
          ? "No resolved candidates to explain."
          : `Explained your top ${count(items.length, "candidate")} of ${resolvedCount} resolved. Top match: ${describeExplanationItem(best)}.`;

      return { steps, message, result: { kind: "explanation", items } };
    }

    case "discovery": {
      const outcome = await runStep(
        steps,
        "discover_cross_domain",
        () =>
          client.insights({
            resultType: input.pageType as QlooEntityType,
            signalEntityIds: likeSeeds.map((seed) => seed.entityId),
            locationQuery: input.locationQuery,
            take: DISCOVERY_TAKE,
            explainability: true,
          }),
        (r) => `Found ${count(r.entities.length, "candidate")} across Qloo's graph.`,
      );
      if (!outcome.ok) return errorResponseFor(steps, outcome.error.message);

      const items = outcome.value.entities.map((scored) => ({
        name: scored.entity.name,
        subtype: scored.entity.subtype,
        ...(scored.entity.disambiguation !== undefined
          ? { disambiguation: scored.entity.disambiguation }
          : {}),
        ...(scored.affinity !== undefined
          ? { affinityPct: Math.round(scored.affinity * 1000) / 10 }
          : {}),
      }));

      return {
        steps,
        message: `Found ${items.length} candidates across Qloo's graph for your taste.`,
        result: { kind: "discovery", items },
      };
    }

    case "policy": {
      const newRules: ProfileRule[] = [];
      const rulesHuman: string[] = [];

      for (const directive of intent.directives) {
        if (directive.op === "collapse-sponsored") {
          newRules.push({ kind: "collapse", match: { flag: "sponsored" } });
          rulesHuman.push("Collapse sponsored results");
          continue;
        }

        const tagAt = Date.now();
        let tags;
        try {
          tags = (await client.searchTags({ query: directive.query, take: 1 })).tags;
        } catch (e) {
          if (e instanceof QlooError) {
            steps.push(makeStep("search_tags", tagAt, "error", e.message));
            return errorResponseFor(steps, e.message);
          }
          throw e;
        }

        const tag = tags[0];
        if (tag === undefined) {
          const detail = `No Qloo tag found for "${directive.query}".`;
          steps.push(makeStep("search_tags", tagAt, "error", detail));
          return errorResponseFor(steps, detail);
        }

        steps.push(
          makeStep("search_tags", tagAt, "ok", `Matched tag "${tag.name}" for "${directive.query}".`),
        );
        if (directive.op === "boost-tag") {
          newRules.push({ kind: "boost", match: { tagId: tag.id }, weight: BOOST_RULE_WEIGHT });
          rulesHuman.push(`Boost ${directive.query}`);
        } else {
          newRules.push({ kind: "exclude", match: { tagId: tag.id } });
          rulesHuman.push(`Exclude ${directive.query}`);
        }
      }

      const previewProfile: TasteProfile = {
        ...input.profile,
        rules: [...input.profile.rules, ...newRules].slice(0, MAX_PROFILE_RULES),
      };

      const outcome = await runStep(
        steps,
        "create_render_plan",
        () => runPageRank({ ...pipelineInput, profile: previewProfile }),
        (p) =>
          `Previewed ${count(newRules.length, "rule")} on ${count(p.ranked.length, "candidate")}.`,
      );
      if (!outcome.ok) return errorResponseFor(steps, outcome.error.message);

      const preview = outcome.value;
      return {
        steps,
        message: `Compiled ${newRules.length} rule(s) and previewed the effect.`,
        result: {
          kind: "policy",
          rules: newRules,
          rulesHuman,
          preview: {
            ranked: preview.ranked,
            plan: preview.plan,
            meta: toRankMeta(preview, Date.now() - input.startedAt),
          },
        },
      };
    }
  }
}

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

  const parsed = agentBodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  try {
    const response = await runAgent({
      message: parsed.data.message,
      pageId: parsed.data.pageId,
      pageType: parsed.data.pageType,
      locationQuery: parsed.data.locationQuery,
      containerId: parsed.data.containerId,
      candidates: parsed.data.candidates,
      profile: parsed.data.profile,
      startedAt,
    });
    return Response.json(response);
  } catch (e) {
    const mapped = pageRankErrorResponse(e);
    if (mapped !== undefined) return mapped;
    return errorResponse(e);
  }
}
