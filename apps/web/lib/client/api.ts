import type { RankedCandidate, RenderPlan, TasteProfile } from "@focal-ai/core";
import type { DemoPage, HealthResponse, RankMeta, RankResponse, SearchResponse } from "./types";

async function readErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message;
  } catch {
    return undefined;
  }
}

export async function searchEntities(input: {
  query: string;
  types?: string[];
  location?: string;
}): Promise<SearchResponse> {
  const res = await fetch("/api/qloo/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message ?? "search failed");
  }
  return (await res.json()) as SearchResponse;
}

export async function rankPage(input: {
  page: DemoPage;
  profile: TasteProfile;
}): Promise<RankResponse> {
  const res = await fetch("/api/try/rank", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageType: input.page.type,
      items: input.page.candidates.map((c) => ({
        clientId: c.clientId,
        name: c.name,
        ...(c.locationText ? { city: c.locationText } : {}),
      })),
      seeds: input.profile.seeds.map((s) => ({
        entityId: s.entityId,
        name: s.name,
        subtype: s.subtype,
        polarity: s.polarity,
      })),
    }),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message ?? "rank failed");
  }
  const data = (await res.json()) as TryRankWire;
  // Lift-only order: the plan's reorder op lists lifted clientIds first; the
  // rest stay in original order. Fall back to input order without a plan.
  const order =
    data.plan?.ops.find((op): op is Extract<RenderPlan["ops"][number], { op: "reorder" }> => op.op === "reorder")?.order ??
    data.items.map((item) => item.clientId);
  const positionOf = new Map(order.map((clientId, i) => [clientId, i] as const));
  return {
    ranked: data.items.map((item) => {
      const { label, affinity, ...rest } = item;
      return {
        ...rest,
        position: positionOf.get(item.clientId) ?? Number.MAX_SAFE_INTEGER,
        ...(label ? { reason: label } : {}),
        ...(affinity !== undefined ? { affinity, affinityPct: Math.round(affinity * 1000) / 10 } : {}),
      } as unknown as RankedCandidate;
    }),
    plan: data.plan ?? EMPTY_PLAN,
    meta: {
      durationMs: data.meta.durationMs,
      unresolved: data.meta.unresolved,
      ...(data.meta.qlooRequest ? { qlooRequest: data.meta.qlooRequest } : {}),
      ...(data.meta.dataSource ? { dataSource: data.meta.dataSource } : {}),
      mock: data.mock,
    },
  };
}

interface TryRankWire {
  status: string;
  items: {
    clientId: string;
    name: string;
    status: string;
    label?: { badge: string; text: string; reasonNames: string[] };
    affinity?: number;
  }[];
  plan: RenderPlan | null;
  mock: boolean;
  meta: { durationMs: number; unresolved: number; qlooRequest?: { path: string; params: Record<string, string> }; dataSource?: RankMeta["dataSource"] };
}

const EMPTY_PLAN: RenderPlan = {
  id: "try",
  pageId: "try",
  createdAt: "",
  ops: [],
  summary: { moved: 0, collapsed: 0, unresolved: 0, avgMovement: 0 },
};

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message ?? "health check failed");
  }
  return (await res.json()) as HealthResponse;
}
