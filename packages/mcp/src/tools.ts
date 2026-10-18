/**
 * MCP tool handlers.
 *
 * `createToolHandlers(deps?)` is injectable for tests: every handler returns an
 * MCP `CallToolResult`, and all QlooError / PipelineError / ProfileFileError
 * failures are mapped to `isError: true` results with clear, key-free messages.
 *
 * Every tool is READ-ONLY — none of these handlers writes to the profile.
 */
import {
  PipelineError,
  runRankPipeline,
  type RankedCandidate,
  type RankPipelineResult,
  type TasteProfile,
} from "@focal-ai/core";
import { QlooError, type QlooClient, type QlooEntityType } from "@focal-ai/qloo";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getQlooClient,
  loadProfile,
  ProfileFileError,
  resolveProfilePath,
  toPipelineInsightsFn,
  toPipelineSearchFn,
  type LoadedProfile,
} from "./deps.js";

const MAX_SEARCH_RESULTS = 5;
const DISCOVERY_TAKE = 6;
const NO_SEEDS_MESSAGE = (profilePath: string) =>
  `No positive taste seeds in the profile at ${profilePath}`;

export interface SearchEntitiesArgs {
  query: string;
  types?: string[];
  location?: string;
}

export interface CandidateInput {
  clientId: string;
  name: string;
  locationText?: string;
  url?: string;
  originalIndex: number;
  sponsored?: boolean;
}

export interface ScoreCandidatesArgs {
  pageId: string;
  pageType: string;
  locationQuery?: string;
  containerId?: string;
  candidates: CandidateInput[];
}

export interface DiscoverCrossDomainArgs {
  pageType: string;
  locationQuery?: string;
}

export interface ExplainRankingArgs extends ScoreCandidatesArgs {
  clientId: string;
}

export interface ToolDeps {
  client: QlooClient;
  loadProfile(): LoadedProfile;
  resolveProfilePath(): string;
}

export interface ToolHandlers {
  getTasteProfile(): Promise<CallToolResult>;
  searchEntities(args: SearchEntitiesArgs): Promise<CallToolResult>;
  scoreCandidates(args: ScoreCandidatesArgs): Promise<CallToolResult>;
  discoverCrossDomain(args: DiscoverCrossDomainArgs): Promise<CallToolResult>;
  explainRanking(args: ExplainRankingArgs): Promise<CallToolResult>;
  createRenderPlan(args: ScoreCandidatesArgs): Promise<CallToolResult>;
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Maps engine errors to agent-readable messages. QlooError messages never
 * carry the API key — only the failing path/status — so they pass through.
 */
function mapError(error: unknown, profilePath: string): string {
  if (error instanceof PipelineError) {
    if (error.code === "NO_SEEDS") return NO_SEEDS_MESSAGE(profilePath);
    return error.message;
  }
  if (error instanceof ProfileFileError || error instanceof QlooError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function toRankedSummary(entry: RankedCandidate) {
  return {
    name: entry.name,
    clientId: entry.clientId,
    position: entry.position,
    ...(entry.affinityPct !== undefined ? { affinityPct: entry.affinityPct } : {}),
    ...(entry.reason?.text !== undefined ? { reason: entry.reason.text } : {}),
    status: entry.status,
  };
}

function planSummary(plan: RankPipelineResult["plan"]) {
  return {
    moved: plan.summary.moved,
    collapsed: plan.summary.collapsed,
    unresolved: plan.summary.unresolved,
  };
}

export function createToolHandlers(overrides: Partial<ToolDeps> = {}): ToolHandlers {
  const deps: ToolDeps = {
    client: overrides.client ?? getQlooClient(),
    loadProfile: overrides.loadProfile ?? loadProfile,
    resolveProfilePath: overrides.resolveProfilePath ?? resolveProfilePath,
  };

  const search = toPipelineSearchFn(deps.client);
  const insights = toPipelineInsightsFn(deps.client);

  function runPipeline(
    args: ScoreCandidatesArgs,
  ): Promise<{ result: RankPipelineResult; profile: TasteProfile }> {
    const { profile } = deps.loadProfile();
    return runRankPipeline({
      pageId: args.pageId,
      pageType: args.pageType,
      ...(args.locationQuery !== undefined ? { locationQuery: args.locationQuery } : {}),
      ...(args.containerId !== undefined ? { containerId: args.containerId } : {}),
      candidates: args.candidates,
      profile,
      deps: { search, insights },
    }).then((result) => ({ result, profile }));
  }

  async function getTasteProfile(): Promise<CallToolResult> {
    const profilePath = deps.resolveProfilePath();
    try {
      const { profile, source } = deps.loadProfile();
      return ok({
        seedCount: profile.seeds.length,
        positiveCount: profile.seeds.filter((seed) => seed.polarity === "like").length,
        seeds: profile.seeds.map((seed) => ({
          name: seed.name,
          subtype: seed.subtype,
          polarity: seed.polarity,
        })),
        rules: profile.rules,
        profilePath,
        source,
      });
    } catch (error) {
      return fail(mapError(error, profilePath));
    }
  }

  async function searchEntities(args: SearchEntitiesArgs): Promise<CallToolResult> {
    try {
      const result = await deps.client.search({
        query: args.query,
        types: args.types as QlooEntityType[] | undefined,
        location: args.location,
        take: MAX_SEARCH_RESULTS,
      });
      const entities = result.entities.slice(0, MAX_SEARCH_RESULTS).map((entity) => ({
        entityId: entity.entityId,
        name: entity.name,
        subtype: entity.subtype,
        ...(entity.disambiguation !== undefined ? { disambiguation: entity.disambiguation } : {}),
      }));
      return ok({ entities });
    } catch (error) {
      return fail(mapError(error, deps.resolveProfilePath()));
    }
  }

  async function scoreCandidates(args: ScoreCandidatesArgs): Promise<CallToolResult> {
    const profilePath = deps.resolveProfilePath();
    try {
      const { result } = await runPipeline(args);
      return ok({
        ranked: result.ranked.map(toRankedSummary),
        summary: planSummary(result.plan),
      });
    } catch (error) {
      return fail(mapError(error, profilePath));
    }
  }

  async function discoverCrossDomain(args: DiscoverCrossDomainArgs): Promise<CallToolResult> {
    const profilePath = deps.resolveProfilePath();
    try {
      const { profile } = deps.loadProfile();
      const seeds = profile.seeds.filter((seed) => seed.polarity === "like");
      if (seeds.length === 0) return fail(NO_SEEDS_MESSAGE(profilePath));

      const result = await deps.client.insights({
        resultType: args.pageType as QlooEntityType,
        signalEntityIds: seeds.map((seed) => seed.entityId),
        ...(args.locationQuery !== undefined ? { locationQuery: args.locationQuery } : {}),
        explainability: true,
        take: DISCOVERY_TAKE,
      });

      const items = result.entities.map((scored) => ({
        name: scored.entity.name,
        subtype: scored.entity.subtype,
        ...(scored.entity.disambiguation !== undefined
          ? { disambiguation: scored.entity.disambiguation }
          : {}),
        ...(scored.affinity !== undefined
          ? { affinityPct: Math.round(scored.affinity * 1000) / 10 }
          : {}),
      }));
      return ok({ items });
    } catch (error) {
      return fail(mapError(error, profilePath));
    }
  }

  async function explainRanking(args: ExplainRankingArgs): Promise<CallToolResult> {
    const profilePath = deps.resolveProfilePath();
    try {
      const { result, profile } = await runPipeline(args);
      const entry = result.ranked.find((candidate) => candidate.clientId === args.clientId);
      if (entry === undefined) {
        return ok({
          clientId: args.clientId,
          resolved: false,
          message: `No candidate with clientId "${args.clientId}" was part of this ranking.`,
        });
      }
      if (entry.status !== "resolved" || entry.affinityPct === undefined) {
        return ok({
          clientId: entry.clientId,
          name: entry.name,
          status: entry.status,
          resolved: false,
          message: `Candidate "${entry.name}" is ${entry.status} — no Qloo affinity to explain.`,
        });
      }

      const seedNames = new Map(profile.seeds.map((seed) => [seed.entityId, seed.name]));
      return ok({
        clientId: entry.clientId,
        name: entry.name,
        status: entry.status,
        resolved: true,
        position: entry.position,
        affinityPct: entry.affinityPct,
        reason: entry.reason ?? null,
        contributions: (entry.scoreMeta?.contributions ?? []).map((contribution) => ({
          entityId: contribution.entityId,
          score: contribution.score,
          ...(seedNames.has(contribution.entityId)
            ? { name: seedNames.get(contribution.entityId) }
            : {}),
        })),
      });
    } catch (error) {
      return fail(mapError(error, profilePath));
    }
  }

  async function createRenderPlan(args: ScoreCandidatesArgs): Promise<CallToolResult> {
    const profilePath = deps.resolveProfilePath();
    try {
      const { result } = await runPipeline(args);
      return ok({ plan: result.plan, summary: result.plan.summary });
    } catch (error) {
      return fail(mapError(error, profilePath));
    }
  }

  return {
    getTasteProfile,
    searchEntities,
    scoreCandidates,
    discoverCrossDomain,
    explainRanking,
    createRenderPlan,
  };
}
