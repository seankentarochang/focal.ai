/**
 * Shared rank pipeline — the single orchestration used by every surface.
 *
 * "resolve candidates -> one insights call -> rank -> plan" lives here so the
 * web route (/api/qloo/rank) and the MCP score_candidates tool run identical
 * logic. The package stays standalone: search and insights are injected
 * functions (PipelineSearchFn / PipelineInsightsFn) adapted at the edges.
 *
 * Mirrors the current web route exactly:
 * 1. Like seeds only, capped at 20; none -> PipelineError("NO_SEEDS").
 * 2. resolveCandidates with the page type and the location query.
 * 3. Zero resolved ids -> no insights call: rank with no scores, plan, validate,
 *    return with meta.insightsCalls 0.
 * 4. Otherwise exactly one insights call scoring the resolved ids against the
 *    like seed ids, take clamped to 20..50, explainability on.
 * 5. Reasons attach only to resolved candidates that carry an affinity.
 * 6. Plan defaults: container "focal:results", annotate, collapseSponsored,
 *    emphasizeThreshold 85; planOptions overrides them. An invalid plan raises
 *    PipelineError("PLAN_INVALID") whose message carries only the error count.
 * 7. meta.unresolved counts only status "unresolved" (ambiguous is NOT
 *    unresolved); meta.qlooRequest is the adapter's request object, present
 *    only when an insights call actually happened.
 */
import { buildReason } from "./evidence";
import { planRender, validatePlan } from "./plan";
import { rankCandidates } from "./rank";
import { resolveCandidates } from "./resolve";
import type {
  CandidateScore,
  CoreEntity,
  CoreResolveFn,
  PageCandidate,
  RankedCandidate,
  RenderPlan,
  TasteProfile,
} from "./types";

const MAX_SEEDS = 20;
const MIN_TAKE = 20;
const MAX_TAKE = 50;
const NO_SEEDS_MESSAGE = "Add at least one positive taste seed before ranking.";

export interface PipelineSearchFn {
  (args: { query: string; types?: string[]; location?: string }): Promise<CoreEntity[]>;
}

export interface PipelineInsightsFn {
  (args: {
    resultType: string;
    signalEntityIds: string[];
    resultEntityIds?: string[];
    locationQuery?: string;
    explainability?: boolean;
    take?: number;
  }): Promise<{
    scores: CandidateScore[];
    request?: { path: string; params: Record<string, string> };
  }>;
}

export interface RankPipelineArgs {
  pageId: string;
  pageType: string;
  locationQuery?: string;
  /** default "focal:results" */
  containerId?: string;
  candidates: PageCandidate[];
  profile: TasteProfile;
  deps: { search: PipelineSearchFn; insights: PipelineInsightsFn; resolve?: CoreResolveFn };
  planOptions?: { annotate?: boolean; emphasizeThreshold?: number; collapseSponsored?: boolean };
}

export interface RankPipelineResult {
  ranked: RankedCandidate[];
  plan: RenderPlan;
  meta: {
    unresolved: number;
    insightsCalls: number;
    qlooRequest?: { path: string; params: Record<string, string> };
  };
}

export class PipelineError extends Error {
  code: "NO_SEEDS" | "PLAN_INVALID";

  constructor(code: "NO_SEEDS" | "PLAN_INVALID", message: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

function planInvalidMessage(errorCount: number): string {
  return `plan validation failed (${errorCount} ${errorCount === 1 ? "error" : "errors"})`;
}

function countUnresolved(ranked: RankedCandidate[]): number {
  return ranked.filter((entry) => entry.status === "unresolved").length;
}

export async function runRankPipeline(args: RankPipelineArgs): Promise<RankPipelineResult> {
  const { pageId, pageType, locationQuery, containerId, candidates, profile, deps, planOptions } =
    args;

  const seeds = profile.seeds.filter((seed) => seed.polarity === "like").slice(0, MAX_SEEDS);
  if (seeds.length === 0) {
    throw new PipelineError("NO_SEEDS", NO_SEEDS_MESSAGE);
  }

  const resolved = await (deps.resolve ?? resolveCandidates)(candidates, deps.search, pageType, {
    location: locationQuery,
  });

  const resolvedIds = resolved.flatMap((candidate) =>
    candidate.status === "resolved" && candidate.entity !== undefined
      ? [candidate.entity.entityId]
      : [],
  );

  if (resolvedIds.length === 0) {
    const ranked = rankCandidates({ candidates: resolved, scores: [], profile });
    const plan = planRender({ pageId, ranked, options: { containerId, ...planOptions } });
    const validation = validatePlan(plan);
    if (!validation.ok) {
      throw new PipelineError("PLAN_INVALID", planInvalidMessage(validation.errors.length));
    }
    return {
      ranked,
      plan,
      meta: { unresolved: countUnresolved(ranked), insightsCalls: 0 },
    };
  }

  const take = Math.min(MAX_TAKE, Math.max(MIN_TAKE, resolvedIds.length));
  const { scores, request } = await deps.insights({
    resultType: pageType,
    signalEntityIds: seeds.map((seed) => seed.entityId),
    resultEntityIds: resolvedIds,
    locationQuery,
    explainability: true,
    take,
  });

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
      ...planOptions,
    },
  });

  const validation = validatePlan(plan);
  if (!validation.ok) {
    throw new PipelineError("PLAN_INVALID", planInvalidMessage(validation.errors.length));
  }

  return {
    ranked,
    plan,
    meta: {
      unresolved: countUnresolved(ranked),
      insightsCalls: 1,
      ...(request !== undefined ? { qlooRequest: request } : {}),
    },
  };
}
