/**
 * FROZEN agent response contract — /api/agent.
 *
 * The UI agent codes against these shapes; do not rename or restructure
 * fields without coordinating. Kept in lib/ (not in the route file) because
 * Next route files must only export HTTP methods.
 */
import type { ProfileRule, RankedCandidate, RenderPlan } from "@focal-ai/core";
import type { RankMeta } from "@/lib/server/pipeline";

export interface AgentStep {
  tool: string;
  summary: string;
  status: "ok" | "error";
  durationMs: number;
}

export interface AgentDiscoveryItem {
  name: string;
  subtype: string;
  disambiguation?: string;
  affinityPct?: number;
}

export interface AgentExplanationItem {
  name: string;
  affinityPct?: number;
  reason?: string;
}

export interface AgentPreview {
  ranked: RankedCandidate[];
  plan: RenderPlan;
  meta: RankMeta;
}

export type AgentResult =
  | { kind: "rank"; ranked: RankedCandidate[]; plan: RenderPlan; meta: RankMeta }
  | { kind: "policy"; rules: ProfileRule[]; rulesHuman: string[]; preview: AgentPreview }
  | { kind: "discovery"; items: AgentDiscoveryItem[] }
  | { kind: "explanation"; items: AgentExplanationItem[] }
  | { kind: "error"; detail: string };

export interface AgentResponse {
  steps: AgentStep[];
  message: string;
  result: AgentResult;
}
