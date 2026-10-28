/**
 * Builds the exact query object the qloo client sends to /v2/insights
 * (addParam semantics: omit undefined / empty lists; take always present).
 * Moved from lib/server/pipeline.ts — the only surviving consumer is the
 * page-rank path, which records it in meta.qlooRequest.
 */
import type { DataSource } from "@focal-ai/qloo";

/** Mirrors INSIGHTS_TAKE_MIN / MAX / QLOO_DEFAULT_INSIGHTS_TAKE in the qloo client. */
const INSIGHTS_TAKE_MIN = 1;
const INSIGHTS_TAKE_MAX = 50;
const INSIGHTS_DEFAULT_TAKE = 20;

/** Same clamp as clampTake() in packages/qloo/src/client.ts (insights bounds). */
function clampInsightsTake(take: number | undefined): number | undefined {
  if (take === undefined || !Number.isFinite(take)) return undefined;
  return Math.min(INSIGHTS_TAKE_MAX, Math.max(INSIGHTS_TAKE_MIN, Math.trunc(take)));
}

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
