import type { TasteProfile } from "@focal-ai/core";
import type { DemoPage, HealthResponse, RankResponse, SearchResponse } from "./types";

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
  const res = await fetch("/api/qloo/rank", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
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
    throw new Error(message ?? "rank failed");
  }
  return (await res.json()) as RankResponse;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message ?? "health check failed");
  }
  return (await res.json()) as HealthResponse;
}
