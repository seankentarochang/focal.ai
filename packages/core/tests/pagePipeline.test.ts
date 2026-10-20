import { describe, expect, it, vi } from "vitest";
import { runPageRank, validatePlan, type CoreEntity, type PageInsightsFn, type PageItem } from "../src/index";
import { profileOf, rule, thing } from "./helpers-v2";

const PLACES: Record<string, CoreEntity> = Object.fromEntries(
  ["Rintaro", "State Bird", "Zuni", "Nari", "Kin Khao", "Olive Garden"].map((name, i) => [
    name,
    {
      entityId: `P${i}`,
      name,
      subtype: "urn:entity:place",
      disambiguation: "San Francisco, CA",
      tagIds: name === "Olive Garden" ? ["urn:tag:chain"] : [],
    },
  ]),
);

const search = vi.fn(async ({ query }: { query: string }) => (PLACES[query] ? [PLACES[query]!] : []));

const AFFINITY: Record<string, number> = { P0: 0.72, P1: 0.95, P2: 0.72, P3: 0.71, P4: 0.73 };

const insights = vi.fn<PageInsightsFn>(async ({ resultEntityIds }) => ({
  scores: resultEntityIds
    .filter((id) => AFFINITY[id] !== undefined)
    .map((id, rankIndex) => ({
      entityId: id,
      affinity: AFFINITY[id],
      rankIndex,
      contributions: [{ entityId: "FUGAZI", score: 1 }],
    })),
  request: { path: "/v2/insights", params: { "filter.type": "urn:entity:place" } },
}));

const page: PageItem[] = ["Rintaro", "State Bird", "Zuni", "Unknown Spot", "Nari", "Kin Khao", "Olive Garden"].map(
  (name, i) => ({ clientId: `c${i}`, name, originalIndex: i, type: "urn:entity:place" }),
);

const profile = profileOf(thing("FUGAZI", { name: "Fugazi", type: "urn:entity:artist", strength: "love" }), rule("urn:tag:chain", { name: "chain" }));

describe("runPageRank", () => {
  it("lifts the clear match with a grounded label and folds rule matches", async () => {
    insights.mockClear();
    const result = await runPageRank({
      pageId: "p1",
      pageType: "urn:entity:place",
      items: [...page, { clientId: "film", name: "Heat", originalIndex: 7, type: "urn:entity:movie" }],
      profile,
      deps: { search, insights },
      locationQuery: "San Francisco",
    });
    expect(insights).toHaveBeenCalledTimes(1);
    expect(insights.mock.calls[0]![0].entitySignals.map((s) => s.id)).toEqual(["FUGAZI"]);
    expect(result.status).toBe("ranked");
    expect(result.plan).not.toBeNull();
    expect(validatePlan(result.plan!)).toEqual({ ok: true });

    const reorder = result.plan!.ops.find((o) => o.op === "reorder");
    expect(reorder).toMatchObject({ order: ["c1", "c0", "c2", "c3", "c4", "c5", "c6"] });
    expect(result.plan!.ops).toContainEqual({
      op: "annotate",
      containerId: "focal:results",
      clientId: "c1",
      text: "Top pick for you · because you like Fugazi",
      badge: "top-pick",
    });
    expect(result.plan!.ops).toContainEqual(
      expect.objectContaining({ op: "collapse", clientIds: ["c6"], label: "1 hidden by your rules (chain)" }),
    );
    expect(result.plan!.summary).toMatchObject({ lifted: 1, collapsed: 1, unresolved: 1 });

    const byId = Object.fromEntries(result.items.map((i) => [i.clientId, i]));
    expect(byId.c3).toMatchObject({ status: "unresolved", outcome: "unscored" });
    expect(byId.c1).toMatchObject({ outcome: "lifted", affinity: 0.95 });
    expect(byId.film).toMatchObject({ status: "skipped", outcome: "skipped" });
    expect(result.meta).toMatchObject({ insightsCalls: 1, resolved: 6, unresolved: 1 });
  });

  it("makes no Qloo calls for a profile with nothing to rank by", async () => {
    search.mockClear();
    insights.mockClear();
    const result = await runPageRank({
      pageId: "p2",
      pageType: "urn:entity:place",
      items: page,
      profile: profileOf(thing("X", { strength: "dislike" })),
      deps: { search, insights },
    });
    expect(result.status).toBe("no_signals");
    expect(result.plan).toBeNull();
    expect(search).not.toHaveBeenCalled();
    expect(insights).not.toHaveBeenCalled();
  });

  it("returns no plan when nothing clearly stands out", async () => {
    const flat = vi.fn<PageInsightsFn>(async ({ resultEntityIds }) => ({
      scores: resultEntityIds.map((id, rankIndex) => ({ entityId: id, affinity: 0.7, rankIndex })),
    }));
    const result = await runPageRank({
      pageId: "p3",
      pageType: "urn:entity:place",
      items: page.slice(0, 5),
      profile: profileOf(thing("FUGAZI", { type: "urn:entity:artist" })),
      deps: { search, insights: flat },
    });
    expect(result.status).toBe("ranked");
    expect(result.plan).toBeNull();
  });
});
