import { describe, expect, it, vi } from "vitest";
import {
  PipelineError,
  runRankPipeline,
  validatePlan,
  type CoreEntity,
  type PageCandidate,
  type PipelineInsightsFn,
  type PipelineSearchFn,
  type RankPipelineArgs,
  type TasteProfile,
  type TasteSeed,
} from "../src/index";

const CITY = "San Francisco";
const PAGE_TYPE = "urn:place:restaurant";

function seed(overrides: Partial<TasteSeed> & { entityId: string; name: string }): TasteSeed {
  return {
    subtype: "urn:entity:place",
    polarity: "like",
    weight: 1,
    source: "typed",
    addedAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

function profile(seeds: TasteSeed[]): TasteProfile {
  return { version: 1, updatedAt: "2026-10-18T00:00:00.000Z", seeds, rules: [] };
}

function candidate(name: string, overrides: Partial<PageCandidate> = {}): PageCandidate {
  return {
    clientId: `c-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    originalIndex: 0,
    ...overrides,
  };
}

function entity(overrides: Partial<CoreEntity> & { entityId: string; name: string }): CoreEntity {
  return { subtype: PAGE_TYPE, ...overrides };
}

function searchReturning(map: Record<string, CoreEntity[]>): PipelineSearchFn {
  return async (args) => map[args.query] ?? [];
}

function baseArgs(overrides: Partial<RankPipelineArgs> = {}): RankPipelineArgs {
  const search: PipelineSearchFn = async () => [];
  const insights: PipelineInsightsFn = async () => ({ scores: [] });
  return {
    pageId: "page-1",
    pageType: PAGE_TYPE,
    candidates: [candidate("Rintaro", { originalIndex: 0 })],
    profile: profile([seed({ entityId: "like-1", name: "Fugazi" })]),
    deps: { search, insights },
    ...overrides,
  };
}

describe("runRankPipeline", () => {
  it("throws NO_SEEDS for an empty profile and never calls the deps", async () => {
    const search = vi.fn<PipelineSearchFn>(async () => []);
    const insights = vi.fn<PipelineInsightsFn>(async () => ({ scores: [] }));
    const args = baseArgs({ profile: profile([]), deps: { search, insights } });

    const error = await runRankPipeline(args).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe("NO_SEEDS");
    expect(search).not.toHaveBeenCalled();
    expect(insights).not.toHaveBeenCalled();
  });

  it("throws NO_SEEDS when the profile holds only dislike seeds", async () => {
    const args = baseArgs({
      profile: profile([seed({ entityId: "nope-1", name: "Airport Food", polarity: "dislike" })]),
    });
    const error = await runRankPipeline(args).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe("NO_SEEDS");
  });

  it("skips insights entirely when nothing resolves (all-unresolved plan)", async () => {
    const search = vi.fn<PipelineSearchFn>(async () => []);
    const insights = vi.fn<PipelineInsightsFn>(async () => ({ scores: [] }));
    const args = baseArgs({
      candidates: [
        candidate("Ghost One", { originalIndex: 0 }),
        candidate("Ghost Two", { originalIndex: 1 }),
      ],
      deps: { search, insights },
    });

    const result = await runRankPipeline(args);

    expect(insights).not.toHaveBeenCalled();
    expect(result.meta.insightsCalls).toBe(0);
    expect(result.meta.unresolved).toBe(2);
    expect(result.meta.qlooRequest).toBeUndefined();
    expect(result.ranked).toHaveLength(2);
    expect(result.ranked.every((entry) => entry.status === "unresolved")).toBe(true);
    expect(result.plan.ops[0]).toEqual({
      op: "reorder",
      containerId: "focal:results",
      order: ["c-ghost-one", "c-ghost-two"],
    });
    expect(validatePlan(result.plan).ok).toBe(true);
  });

  it("counts only 'unresolved' status toward meta.unresolved (ambiguous excluded)", async () => {
    const search = vi.fn<PipelineSearchFn>(
      searchReturning({
        Rintaro: [entity({ entityId: "ny-1", name: "Rintaro", disambiguation: "New York, NY" })],
      }),
    );
    const insights = vi.fn<PipelineInsightsFn>(async () => ({ scores: [] }));

    const result = await runRankPipeline(
      baseArgs({
        candidates: [candidate("Rintaro", { originalIndex: 0, locationText: CITY })],
        deps: { search, insights },
      }),
    );

    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0]?.status).toBe("ambiguous");
    expect(result.ranked[0]?.entity?.entityId).toBe("ny-1");
    expect(result.meta.unresolved).toBe(0);
    expect(result.meta.insightsCalls).toBe(0);
    expect(insights).not.toHaveBeenCalled();
  });

  it("ranks, explains and plans a mixed resolution with one insights call", async () => {
    const search = vi.fn<PipelineSearchFn>(
      searchReturning({
        Rintaro: [entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" })],
      }),
    );
    const request = {
      path: "/v2/insights",
      params: { "filter.type": PAGE_TYPE, "signal.interests.entities": "like-1", take: "20" },
    };
    const insights = vi.fn<PipelineInsightsFn>(async () => ({
      scores: [
        {
          entityId: "sf-1",
          affinity: 0.93,
          rankIndex: 0,
          contributions: [{ entityId: "like-1", score: 0.42 }],
        },
      ],
      request,
    }));

    const { ranked, plan, meta } = await runRankPipeline(
      baseArgs({
        locationQuery: CITY,
        candidates: [
          candidate("Rintaro", { originalIndex: 0, locationText: CITY }),
          candidate("Ghost Place", { originalIndex: 1 }),
        ],
        deps: { search, insights },
      }),
    );

    expect(ranked.map((entry) => entry.clientId)).toEqual(["c-rintaro", "c-ghost-place"]);
    expect(ranked[0]?.position).toBe(0);
    expect(ranked[1]?.position).toBe(1);
    expect(ranked[0]?.affinityPct).toBe(93);
    expect(ranked[0]?.reason?.text).toBe("Matches your taste for Fugazi");
    expect(ranked[1]?.reason).toBeUndefined();

    expect(plan.ops[0]?.op).toBe("reorder");
    expect(plan.ops).toContainEqual({
      op: "annotate",
      containerId: "focal:results",
      clientId: "c-rintaro",
      text: "93% match",
    });
    expect(plan.ops).toContainEqual({
      op: "emphasize",
      containerId: "focal:results",
      clientId: "c-rintaro",
      level: "high",
    });
    expect(validatePlan(plan).ok).toBe(true);

    expect(meta.insightsCalls).toBe(1);
    expect(meta.unresolved).toBe(1);
    expect(meta.qlooRequest).toBe(request);
  });

  it("calls insights with like seeds only, resolved ids only, take 20 and explainability", async () => {
    const search = vi.fn<PipelineSearchFn>(
      searchReturning({
        Rintaro: [entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" })],
      }),
    );
    const insights = vi.fn<PipelineInsightsFn>(async () => ({ scores: [] }));

    const result = await runRankPipeline(
      baseArgs({
        locationQuery: CITY,
        candidates: [candidate("Rintaro", { originalIndex: 0, locationText: CITY })],
        profile: profile([
          seed({ entityId: "like-1", name: "Fugazi" }),
          seed({ entityId: "dislike-1", name: "Airport Food", polarity: "dislike" }),
        ]),
        deps: { search, insights },
      }),
    );

    expect(insights).toHaveBeenCalledTimes(1);
    expect(insights).toHaveBeenCalledWith({
      resultType: PAGE_TYPE,
      signalEntityIds: ["like-1"],
      resultEntityIds: ["sf-1"],
      locationQuery: CITY,
      explainability: true,
      take: 20,
    });
    expect(result.meta.qlooRequest).toBeUndefined();
  });

  it("clamps the insights take to 50 when more candidates resolve", async () => {
    const candidates = Array.from({ length: 55 }, (_, i) =>
      candidate(`Place ${i}`, { clientId: `c-${i}`, originalIndex: i }),
    );
    const search = vi.fn<PipelineSearchFn>(async (args) => [
      entity({ entityId: `e-${args.query.split(" ")[1]}`, name: args.query }),
    ]);
    const insights = vi.fn<PipelineInsightsFn>(async () => ({ scores: [] }));

    await runRankPipeline(baseArgs({ candidates, deps: { search, insights } }));

    expect(insights).toHaveBeenCalledTimes(1);
    expect(insights.mock.calls[0]?.[0]?.take).toBe(50);
    expect(insights.mock.calls[0]?.[0]?.resultEntityIds).toHaveLength(55);
  });

  it("passes pageType and locationQuery through to resolution search", async () => {
    const search = vi.fn<PipelineSearchFn>(async () => []);
    const insights = vi.fn<PipelineInsightsFn>(async () => ({ scores: [] }));

    await runRankPipeline(
      baseArgs({
        locationQuery: CITY,
        candidates: [
          candidate("Ghost One", { clientId: "c1", originalIndex: 0 }),
          candidate("Ghost Two", { clientId: "c2", originalIndex: 1, locationText: "Oakland" }),
        ],
        deps: { search, insights },
      }),
    );

    expect(search).toHaveBeenNthCalledWith(1, {
      query: "Ghost One",
      types: [PAGE_TYPE],
      location: CITY,
    });
    expect(search).toHaveBeenNthCalledWith(2, {
      query: "Ghost Two",
      types: [PAGE_TYPE],
      location: "Oakland",
    });
  });

  it("lets planOptions override the plan defaults", async () => {
    const search = vi.fn<PipelineSearchFn>(
      searchReturning({
        Rintaro: [entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" })],
      }),
    );
    const insights = vi.fn<PipelineInsightsFn>(async () => ({
      scores: [{ entityId: "sf-1", affinity: 0.93, rankIndex: 0 }],
    }));

    const { plan } = await runRankPipeline(
      baseArgs({
        locationQuery: CITY,
        candidates: [candidate("Rintaro", { originalIndex: 0, locationText: CITY })],
        deps: { search, insights },
        planOptions: { annotate: false, emphasizeThreshold: 99 },
      }),
    );

    const opKinds = plan.ops.map((op) => op.op);
    expect(opKinds).toContain("reorder");
    expect(opKinds).not.toContain("annotate");
    expect(opKinds).not.toContain("emphasize");
  });

  it("throws PLAN_INVALID with a count-only message when plan validation fails", async () => {
    const args = baseArgs({ containerId: "not-a-valid-container" });

    const error = await runRankPipeline(args).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe("PLAN_INVALID");
    expect((error as Error).message).toBe("plan validation failed (1 error)");
  });
});
