/**
 * Shared web wrapper around @focal-ai/core's runRankPipeline.
 *
 * Every web surface that ranks candidates (/api/qloo/rank and /api/agent) goes
 * through runPageRank so search/insights wiring, take clamping and the recorded
 * Qloo request object live in exactly one place.
 *
 * Error mapping choice (documented once, here): runPageRank rethrows core
 * pipeline failures as a typed PageRankError and the ROUTES map it to HTTP via
 * pageRankErrorResponse — the wrapper never builds a Response. This keeps the
 * rank route and the agent route (which also runs the pipeline for previews)
 * on the same mapping.
 *
 * The insights dependency mirrors packages/qloo/src/client.ts param building
 * byte-for-byte (key names, comma joins, take clamp 1..50 with default 20) so
 * meta.qlooRequest is exactly the URLSearchParams the client sends.
 */
import {
  PipelineError,
  runRankPipeline,
  type PageCandidate,
  type PipelineInsightsFn,
  type RankPipelineResult,
  type TasteProfile,
} from "@focal-ai/core";
import { warmSearchCache, type DataSource, type QlooClient, type QlooEntityType } from "@focal-ai/qloo";
import { toCandidateScores, toCoreSearchFn } from "@/lib/server/adapters";
import { dataSource, getQlooClient } from "@/lib/server/qloo";

/** Mirrors INSIGHTS_TAKE_MIN / MAX / QLOO_DEFAULT_INSIGHTS_TAKE in the qloo client. */
const INSIGHTS_TAKE_MIN = 1;
const INSIGHTS_TAKE_MAX = 50;
const INSIGHTS_DEFAULT_TAKE = 20;

/** Same take the resolve adapter uses, so warmed cache entries are the ones the pipeline reads. */
const RESOLVE_SEARCH_TAKE = 3;

export interface RunPageRankInput {
  pageId: string;
  pageType: string;
  locationQuery?: string;
  containerId?: string;
  candidates: PageCandidate[];
  profile: TasteProfile;
}

/** Typed wrapper for core PipelineError; routes map it via pageRankErrorResponse. */
export class PageRankError extends Error {
  readonly code: PipelineError["code"];

  constructor(code: PipelineError["code"], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PageRankError";
    this.code = code;
  }
}

export interface RankMeta {
  dataSource: DataSource;
  durationMs: number;
  unresolved: number;
  qlooRequest: { path: string; params: Record<string, string> };
}

/** Same clamp as clampTake() in packages/qloo/src/client.ts (insights bounds). */
function clampInsightsTake(take: number | undefined): number | undefined {
  if (take === undefined || !Number.isFinite(take)) return undefined;
  return Math.min(INSIGHTS_TAKE_MAX, Math.max(INSIGHTS_TAKE_MIN, Math.trunc(take)));
}

/**
 * Builds the exact query object the qloo client would send to /v2/insights
 * (addParam semantics: omit undefined / empty lists; take always present).
 */
export function buildInsightsParams(args: {
  resultType: string;
  signalEntityIds: string[];
  signalTagIds?: string[];
  resultEntityIds?: string[];
  locationQuery?: string;
  explainability?: boolean;
  take?: number;
}): Record<string, string> {
  const params: Record<string, string> = {};
  params["filter.type"] = args.resultType;
  if (args.signalEntityIds.length > 0) {
    params["signal.interests.entities"] = args.signalEntityIds.join(",");
  }
  if (args.signalTagIds !== undefined && args.signalTagIds.length > 0) {
    params["signal.interests.tags"] = args.signalTagIds.join(",");
  }
  if (args.resultEntityIds !== undefined && args.resultEntityIds.length > 0) {
    params["filter.results.entities"] = args.resultEntityIds.join(",");
  }
  if (args.locationQuery !== undefined) {
    params["filter.location.query"] = args.locationQuery;
  }
  if (args.explainability === true) {
    params["feature.explainability"] = "true";
  }
  params["take"] = String(clampInsightsTake(args.take) ?? INSIGHTS_DEFAULT_TAKE);
  return params;
}

/**
 * One warm request per unique (name, type, location) tuple, mirroring the
 * resolver's search calls. Pacing keeps the upstream under the 5 req/s burst
 * limit; the cache entries warmed here are exactly the keys the resolver reads
 * (same take), so the pipeline resolves from cache instead of re-querying.
 */
function candidateWarmRequests(input: RunPageRankInput) {
  const seen = new Set<string>();
  const requests: { query: string; types: string[]; location?: string }[] = [];
  for (const candidate of input.candidates) {
    const location = candidate.locationText ?? input.locationQuery;
    const key = JSON.stringify([candidate.name, input.pageType, location ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push({
      query: candidate.name,
      types: [input.pageType],
      ...(location !== undefined ? { location } : {}),
    });
  }
  return requests;
}

/**
 * Per-process memo of completed warm passes, keyed by page type + location +
 * the sorted warm request tuples. The client's own TTL cache already holds the
 * warmed results, but warmSearchCache still pays its pacing floor on every
 * call; skipping a re-warm lets repeat ranks resolve from that cache instantly.
 * In-memory per server instance (fine for the demo's scale); 5 minutes mirrors
 * the client cache's 10-minute TTL while leaving slack for expiry.
 */
const WARM_MEMO_TTL_MS = 5 * 60 * 1000;
const warmMemo = new Map<string, number>();

function warmMemoKey(
  input: RunPageRankInput,
  requests: { query: string; types: string[]; location?: string }[],
): string {
  const tuples = requests
    .map((request) => [request.query, request.types, request.location ?? null])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({
    pageType: input.pageType,
    locationQuery: input.locationQuery ?? null,
    requests: tuples,
  });
}

/** Best-effort cache warming: never throws, never fails the rank request. */
async function warmCandidateSearch(client: QlooClient, input: RunPageRankInput): Promise<void> {
  const requests = candidateWarmRequests(input);
  if (requests.length === 0) return;

  const key = warmMemoKey(input, requests);
  const warmedAt = warmMemo.get(key);
  if (warmedAt !== undefined) {
    if (Date.now() - warmedAt < WARM_MEMO_TTL_MS) return;
    warmMemo.delete(key);
  }

  const warmingClient: QlooClient = {
    ...client,
    search: (params) => client.search({ ...params, take: RESOLVE_SEARCH_TAKE }),
  };
  try {
    await warmSearchCache(warmingClient, requests);
    warmMemo.set(key, Date.now());
  } catch {
    // Leave the memo cold so the next rank retries the warm pass.
  }
}

export async function runPageRank(input: RunPageRankInput): Promise<RankPipelineResult> {
  const client = getQlooClient();
  const search = toCoreSearchFn(client, RESOLVE_SEARCH_TAKE);

  if (input.profile.seeds.some((seed) => seed.polarity === "like")) {
    await warmCandidateSearch(client, input);
  }
  const insights: PipelineInsightsFn = async (args) => {
    const params = buildInsightsParams(args);
    const result = await client.insights({
      resultType: args.resultType as QlooEntityType,
      signalEntityIds: args.signalEntityIds,
      resultEntityIds: args.resultEntityIds,
      locationQuery: args.locationQuery,
      explainability: args.explainability,
      take: args.take,
    });
    return { scores: toCandidateScores(result.entities), request: { path: "/v2/insights", params } };
  };

  try {
    return await runRankPipeline({
      pageId: input.pageId,
      pageType: input.pageType,
      locationQuery: input.locationQuery,
      containerId: input.containerId,
      candidates: input.candidates,
      profile: input.profile,
      deps: { search, insights },
    });
  } catch (e) {
    if (e instanceof PipelineError) {
      throw new PageRankError(e.code, e.message, { cause: e });
    }
    throw e;
  }
}

/**
 * HTTP mapping for PageRankError, shared by the rank route and the agent route.
 * Returns undefined for anything else so callers fall through to errorResponse.
 *
 * Messages are the frozen route contract:
 * - NO_SEEDS    -> 400 BAD_REQUEST (core's PipelineError message is identical)
 * - PLAN_INVALID -> 500 INTERNAL (the route hides core's error count on purpose)
 */
export function pageRankErrorResponse(e: unknown): Response | undefined {
  if (!(e instanceof PageRankError)) return undefined;
  if (e.code === "NO_SEEDS") {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: "Add at least one positive taste seed before ranking." } },
      { status: 400 },
    );
  }
  return Response.json(
    { error: { code: "INTERNAL", message: "plan validation failed" } },
    { status: 500 },
  );
}

/**
 * Shared rank meta. durationMs is measured by the caller (rank route: request
 * start), unresolved comes from the pipeline and qlooRequest keeps the
 * unresolved-only placeholder shape the Inspector/route tests expect.
 */
export function toRankMeta(pipeline: RankPipelineResult, durationMs: number): RankMeta {
  return {
    dataSource: dataSource(),
    durationMs,
    unresolved: pipeline.meta.unresolved,
    qlooRequest: pipeline.meta.qlooRequest ?? { path: "/v2/insights", params: {} },
  };
}
