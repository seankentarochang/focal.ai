import {
  runPageRank as runCorePageRank,
  type PageInsightsFn,
  type PageItem,
  type PageRankResult,
  type ProfileV2,
} from "@focal-ai/core";
import type { QlooEntityType } from "@focal-ai/qloo";
import { toCandidateScores, toCoreSearchFn } from "../adapters";
import { buildInsightsParams } from "../pipeline";
import { getQlooClient } from "../qloo";
import { toInsightType, type PageRankBody } from "./schemas";

const RESOLVE_SEARCH_TAKE = 3;

/**
 * The qloo client cannot send tag signals yet and Qloo's handling of them is
 * UNVERIFIED (V-01), so vibes act as local boosts on every type for now.
 */
const SIGNAL_CONFIG = { tagSignalTypes: "none" as const };

function pageInsights(): PageInsightsFn {
  const client = getQlooClient();
  return async (args) => {
    const signalEntityIds = args.entitySignals.map((s) => s.id);
    const query = {
      resultType: args.resultType,
      signalEntityIds,
      resultEntityIds: args.resultEntityIds,
      locationQuery: args.locationQuery,
      explainability: args.explainability,
      take: args.take,
    };
    const result = await client.insights({ ...query, resultType: args.resultType as QlooEntityType });
    return { scores: toCandidateScores(result.entities), request: { path: "/v2/insights", params: buildInsightsParams(query) } };
  };
}

function mostCommonCity(body: PageRankBody): string | undefined {
  const counts = new Map<string, number>();
  for (const item of body.items) if (item.city) counts.set(item.city, (counts.get(item.city) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Server side of the extension's rank request: one insights call, lift-only plan. */
export async function rankPage(body: PageRankBody, profile: ProfileV2, pageId: string): Promise<PageRankResult | null> {
  const pageType = toInsightType(body.pageType);
  if (!pageType) return null;
  const items: PageItem[] = body.items.map((item, originalIndex) => {
    const type = toInsightType(item.type);
    return {
      clientId: item.clientId,
      name: item.name,
      originalIndex,
      ...(type ? { type } : {}),
      ...(item.city ? { city: item.city } : {}),
    };
  });
  const locationQuery = body.pageType === "place" || body.pageType === "destination" ? mostCommonCity(body) : undefined;
  return runCorePageRank({
    pageId,
    pageType,
    items,
    profile,
    ...(locationQuery ? { locationQuery } : {}),
    signalConfig: SIGNAL_CONFIG,
    deps: { search: toCoreSearchFn(getQlooClient(), RESOLVE_SEARCH_TAKE), insights: pageInsights() },
  });
}
