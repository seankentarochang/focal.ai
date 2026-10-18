import type { ProfileRule, RankedCandidate, RenderPlan, TasteProfile } from "@focal-ai/core";
import type { DemoPage, RankMeta } from "./types";

export interface AgentStep {
  tool: string;
  summary: string;
  status: "ok" | "error";
  durationMs: number;
}

export type AgentResult =
  | { kind: "rank"; ranked: RankedCandidate[]; plan: RenderPlan; meta: RankMeta }
  | {
      kind: "policy";
      rules: ProfileRule[];
      rulesHuman: string[];
      preview: { ranked: RankedCandidate[]; plan: RenderPlan; meta: RankMeta };
    }
  | {
      kind: "discovery";
      items: { name: string; subtype: string; disambiguation?: string; affinityPct?: number }[];
    }
  | { kind: "explanation"; items: { name: string; affinityPct?: number; reason?: string }[] }
  | { kind: "error"; detail: string };

export interface AgentResponse {
  steps: AgentStep[];
  message: string;
  result: AgentResult;
}

export const QUICK_PROMPTS = [
  "Rank this page",
  "Find me something similar",
  "Explain the top results",
  "Hide sponsored",
];

async function readErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message;
  } catch {
    return undefined;
  }
}

export async function runAgent(input: {
  message: string;
  page: DemoPage;
  profile: TasteProfile;
}): Promise<AgentResponse> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: input.message,
      pageId: input.page.id,
      pageType: input.page.type,
      locationQuery: input.page.locationQuery,
      containerId: input.page.containerId,
      candidates: input.page.candidates,
      profile: input.profile,
    }),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message ?? "agent failed");
  }
  return (await res.json()) as AgentResponse;
}
