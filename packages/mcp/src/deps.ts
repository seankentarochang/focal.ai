/**
 * Local dependency adapters for the focal MCP server.
 *
 * apps/web carries an equivalent edge adapter (apps/web/lib/server/adapters.ts
 * plus the insights-params reconstruction in its rank route); web and MCP both
 * call @focal-ai/core's runRankPipeline. Packages never import from apps/, so
 * this file is the MCP-side copy of that seam.
 *
 * Read-only by design: the only filesystem access is reading the taste profile
 * (FOCAL_PROFILE_PATH). This server never writes a profile — there is
 * deliberately no saveProfile.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createEmptyProfile,
  deserializeProfile,
  type CandidateScore,
  type CoreEntity,
  type PipelineInsightsFn,
  type PipelineSearchFn,
  type TasteProfile,
} from "@focal-ai/core";
import {
  createQlooClient,
  type QlooClient,
  type QlooEntity,
  type QlooEntityType,
  type ScoredEntity,
} from "@focal-ai/qloo";

const SEARCH_TAKE = 3;
const INSIGHTS_PATH = "/v2/insights";

export interface LoadedProfile {
  profile: TasteProfile;
  /**
   * Human-readable provenance for the loaded profile:
   * `file: <path>` when read from disk, or the missing-file note when the
   * profile was substituted with an empty one.
   */
  source: string;
}

/**
 * Raised when the profile file exists but cannot be read or parsed. A missing
 * file is NOT an error (empty profile + note) — but a corrupt file is, because
 * silently serving an empty profile would produce misleading "no seeds"
 * answers.
 */
export class ProfileFileError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(
      `Invalid taste profile at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "ProfileFileError";
    this.path = path;
  }
}

/** FOCAL_PROFILE_PATH, defaulting to ~/.focal/profile.json. */
export function resolveProfilePath(): string {
  return process.env.FOCAL_PROFILE_PATH ?? join(homedir(), ".focal", "profile.json");
}

/** Read the local taste profile (missing file -> empty profile + note). */
export function loadProfile(): LoadedProfile {
  const path = resolveProfilePath();
  if (!existsSync(path)) {
    return {
      profile: createEmptyProfile(),
      source: `file not found at ${path} — using an empty profile`,
    };
  }
  let json: string;
  try {
    json = readFileSync(path, "utf8");
  } catch (error) {
    throw new ProfileFileError(path, error);
  }
  try {
    return { profile: deserializeProfile(json), source: `file: ${path}` };
  } catch (error) {
    throw new ProfileFileError(path, error);
  }
}

let client: QlooClient | undefined;

/** Lazy env-driven Qloo client (QLOO_API_KEY / QLOO_API_BASE / QLOO_MOCK=1). */
export function getQlooClient(): QlooClient {
  if (client === undefined) client = createQlooClient();
  return client;
}

export function toCoreEntity(e: QlooEntity): CoreEntity {
  return {
    entityId: e.entityId,
    name: e.name,
    subtype: e.subtype,
    disambiguation: e.disambiguation,
    popularity: e.popularity,
    tagIds: e.tagIds,
    tagNames: e.tagNames,
  };
}

export function toCandidateScores(entities: ScoredEntity[]): CandidateScore[] {
  return entities.map((scored) => ({
    entityId: scored.entity.entityId,
    affinity: scored.affinity,
    rankIndex: scored.rankIndex,
    contributions: scored.contributions,
    tagNames: scored.entity.tagNames,
  }));
}

/** CoreSearchFn/PipelineSearchFn seam over QlooClient.search (as in web). */
export function toPipelineSearchFn(client: QlooClient, take = SEARCH_TAKE): PipelineSearchFn {
  return async ({ query, types, location }) => {
    const result = await client.search({
      query,
      types: types as QlooEntityType[] | undefined,
      location,
      take,
    });
    return result.entities.map(toCoreEntity);
  };
}

/**
 * PipelineInsightsFn seam over QlooClient.insights, mirroring the web route:
 * the returned `request` reconstructs the upstream query params (key excluded)
 * exactly as the client builds them, so meta.qlooRequest stays truthful.
 */
export function toPipelineInsightsFn(client: QlooClient): PipelineInsightsFn {
  return async ({
    resultType,
    signalEntityIds,
    resultEntityIds,
    locationQuery,
    explainability,
    take,
  }) => {
    const result = await client.insights({
      resultType: resultType as QlooEntityType,
      signalEntityIds,
      ...(resultEntityIds !== undefined ? { resultEntityIds } : {}),
      ...(locationQuery !== undefined ? { locationQuery } : {}),
      ...(explainability !== undefined ? { explainability } : {}),
      ...(take !== undefined ? { take } : {}),
    });

    const params: Record<string, string> = { "filter.type": resultType };
    if (signalEntityIds.length > 0) {
      params["signal.interests.entities"] = signalEntityIds.join(",");
    }
    if (resultEntityIds !== undefined && resultEntityIds.length > 0) {
      params["filter.results.entities"] = resultEntityIds.join(",");
    }
    if (locationQuery !== undefined) params["filter.location.query"] = locationQuery;
    if (explainability === true) params["feature.explainability"] = "true";
    if (take !== undefined) params["take"] = String(take);

    return {
      scores: toCandidateScores(result.entities),
      request: { path: INSIGHTS_PATH, params },
    };
  };
}
