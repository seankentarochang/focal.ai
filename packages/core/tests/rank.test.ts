import { describe, expect, it } from "vitest";
import {
  rankCandidates,
  type CandidateScore,
  type RankedCandidate,
  type ResolvedCandidate,
  type ResolutionStatus,
  type TasteProfile,
} from "../src/index";

function makeCandidate(opts: {
  clientId: string;
  originalIndex: number;
  entityId?: string;
  status?: ResolutionStatus;
  tags?: string[];
  sponsored?: boolean;
}): ResolvedCandidate {
  const status = opts.status ?? (opts.entityId !== undefined ? "resolved" : "unresolved");
  return {
    clientId: opts.clientId,
    name: opts.clientId,
    originalIndex: opts.originalIndex,
    sponsored: opts.sponsored,
    status,
    entity:
      opts.entityId !== undefined
        ? {
            entityId: opts.entityId,
            name: opts.clientId,
            subtype: "urn:entity:place",
            tagIds: opts.tags ?? [],
          }
        : undefined,
  };
}

function score(entityId: string, affinity: number | undefined, extra: Partial<CandidateScore> = {}): CandidateScore {
  return { entityId, rankIndex: 0, ...(affinity !== undefined ? { affinity } : {}), ...extra };
}

function profile(overrides: Partial<TasteProfile> = {}): TasteProfile {
  return { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", seeds: [], rules: [], ...overrides };
}

function seed(entityId: string, name: string, polarity: "like" | "dislike") {
  return {
    entityId,
    name,
    subtype: "urn:entity:place",
    polarity,
    weight: 1,
    source: "searched" as const,
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const clientIds = (ranked: RankedCandidate[]) => ranked.map((r) => r.clientId);

describe("rankCandidates", () => {
  it("orders resolved candidates by affinity descending", () => {
    const candidates = [
      makeCandidate({ clientId: "a", originalIndex: 0, entityId: "e-a" }),
      makeCandidate({ clientId: "b", originalIndex: 1, entityId: "e-b" }),
      makeCandidate({ clientId: "c", originalIndex: 2, entityId: "e-c" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-a", 0.2), score("e-b", 0.9), score("e-c", 0.5)],
      profile: profile(),
    });
    expect(clientIds(ranked)).toEqual(["b", "c", "a"]);
    expect(ranked.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(ranked.map((r) => r.affinityPct)).toEqual([90, 50, 20]);
  });

  it("breaks score ties stably on originalIndex", () => {
    const candidates = [
      makeCandidate({ clientId: "first", originalIndex: 0, entityId: "e-1" }),
      makeCandidate({ clientId: "second", originalIndex: 1, entityId: "e-2" }),
      makeCandidate({ clientId: "third", originalIndex: 2, entityId: "e-3" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-1", 0.5), score("e-2", 0.5), score("e-3", 0.5)],
      profile: profile(),
    });
    expect(clientIds(ranked)).toEqual(["first", "second", "third"]);
  });

  it("sinks unresolved candidates below ambiguous ones, even when the ambiguous one is scored", () => {
    const candidates = [
      makeCandidate({ clientId: "res", originalIndex: 0, entityId: "e-res" }),
      makeCandidate({ clientId: "amb", originalIndex: 1, entityId: "e-amb", status: "ambiguous" }),
      makeCandidate({ clientId: "unres", originalIndex: 2 }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-res", 0.3), score("e-amb", 0.99)],
      profile: profile(),
    });
    expect(clientIds(ranked)).toEqual(["res", "amb", "unres"]);
    expect(ranked.map((r) => r.status)).toEqual(["resolved", "ambiguous", "unresolved"]);
  });

  it("keeps unresolved candidates in their original relative order", () => {
    const candidates = [
      makeCandidate({ clientId: "u5", originalIndex: 5 }),
      makeCandidate({ clientId: "u3", originalIndex: 3 }),
      makeCandidate({ clientId: "res", originalIndex: 0, entityId: "e-1" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-1", 0.1)],
      profile: profile(),
    });
    expect(clientIds(ranked)).toEqual(["res", "u3", "u5"]);
  });

  it("places resolved-without-affinity below resolved-with-score and never assigns it a favorable score", () => {
    const candidates = [
      makeCandidate({ clientId: "no-score", originalIndex: 0, entityId: "e-none" }),
      makeCandidate({ clientId: "low", originalIndex: 1, entityId: "e-low" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-low", 0.1)],
      profile: profile(),
    });
    expect(clientIds(ranked)).toEqual(["low", "no-score"]);
    const noScore = ranked.find((r) => r.clientId === "no-score");
    expect(noScore?.affinity).toBeUndefined();
    expect(noScore?.affinityPct).toBeUndefined();
  });

  it("sinks a disliked entity to -1 with a ruleEffect, keeping the raw affinityPct", () => {
    const candidates = [
      makeCandidate({ clientId: "liked", originalIndex: 0, entityId: "e-like" }),
      makeCandidate({ clientId: "hated", originalIndex: 1, entityId: "e-hate" }),
      makeCandidate({ clientId: "weak", originalIndex: 2, entityId: "e-weak" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-like", 0.9), score("e-hate", 0.8), score("e-weak", 0.1)],
      profile: profile({ seeds: [seed("e-hate", "Hated Place", "dislike")] }),
    });
    expect(clientIds(ranked)).toEqual(["liked", "weak", "hated"]);
    const hated = ranked.find((r) => r.clientId === "hated");
    expect(hated?.ruleEffects).toEqual([{ kind: "exclude", label: "you marked this as disliked" }]);
    expect(hated?.affinityPct).toBe(80);
  });

  it("boost changes order but never the affinityPct", () => {
    const candidates = [
      makeCandidate({ clientId: "boosted", originalIndex: 0, entityId: "e-boost", tags: ["urn:tag:coffee"] }),
      makeCandidate({ clientId: "plain", originalIndex: 1, entityId: "e-plain" }),
    ];
    const scores = [score("e-boost", 0.4), score("e-plain", 0.6)];
    const before = rankCandidates({ candidates, scores, profile: profile() });
    expect(clientIds(before)).toEqual(["plain", "boosted"]);

    const after = rankCandidates({
      candidates,
      scores,
      profile: profile({ rules: [{ kind: "boost", match: { tagId: "urn:tag:coffee" }, weight: 2 }] }),
    });
    expect(clientIds(after)).toEqual(["boosted", "plain"]);
    const boosted = after.find((r) => r.clientId === "boosted");
    expect(boosted?.affinityPct).toBe(40);
    expect(boosted?.affinity).toBe(0.4);
  });

  it("uses the default boost weight of 1.5", () => {
    const candidates = [
      makeCandidate({ clientId: "boosted", originalIndex: 0, entityId: "e-boost", tags: ["urn:tag:jazz"] }),
      makeCandidate({ clientId: "plain", originalIndex: 1, entityId: "e-plain" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-boost", 0.5), score("e-plain", 0.6)],
      profile: profile({ rules: [{ kind: "boost", match: { tagId: "urn:tag:jazz" } }] }),
    });
    expect(clientIds(ranked)).toEqual(["boosted", "plain"]);
  });

  it("a boost never invents a score when affinity is missing", () => {
    const candidates = [
      makeCandidate({ clientId: "tagged", originalIndex: 0, entityId: "e-tagged", tags: ["urn:tag:jazz"] }),
      makeCandidate({ clientId: "plain", originalIndex: 1, entityId: "e-plain" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-plain", 0.1)],
      profile: profile({ rules: [{ kind: "boost", match: { tagId: "urn:tag:jazz" }, weight: 5 }] }),
    });
    expect(clientIds(ranked)).toEqual(["plain", "tagged"]);
    const tagged = ranked.find((r) => r.clientId === "tagged");
    expect(tagged?.affinityPct).toBeUndefined();
    expect(tagged?.ruleEffects).toBeUndefined();
  });

  it("rounds affinityPct to one decimal", () => {
    const candidates = [
      makeCandidate({ clientId: "r1", originalIndex: 0, entityId: "e-1" }),
      makeCandidate({ clientId: "r2", originalIndex: 1, entityId: "e-2" }),
      makeCandidate({ clientId: "r3", originalIndex: 2, entityId: "e-3" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-1", 0.1234), score("e-2", 0.999), score("e-3", 1)],
      profile: profile(),
    });
    const pct = new Map(ranked.map((r) => [r.clientId, r.affinityPct]));
    expect(pct.get("r1")).toBe(12.3);
    expect(pct.get("r2")).toBe(99.9);
    expect(pct.get("r3")).toBe(100);
  });

  it("passes scoreMeta through only when contributions or tagNames are present", () => {
    const candidates = [
      makeCandidate({ clientId: "meta", originalIndex: 0, entityId: "e-meta" }),
      makeCandidate({ clientId: "bare", originalIndex: 1, entityId: "e-bare" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [
        score("e-meta", 0.5, {
          contributions: [{ entityId: "e-seed", score: 0.7 }],
          tagNames: ["Jazz"],
        }),
        score("e-bare", 0.4),
      ],
      profile: profile(),
    });
    const meta = ranked.find((r) => r.clientId === "meta");
    expect(meta?.scoreMeta).toEqual({
      contributions: [{ entityId: "e-seed", score: 0.7 }],
      tagNames: ["Jazz"],
    });
    expect(ranked.find((r) => r.clientId === "bare")?.scoreMeta).toBeUndefined();
  });

  it("records exclude ruleEffects for tagId, brandId and sponsored matches without reordering", () => {
    const candidates = [
      makeCandidate({ clientId: "tagged", originalIndex: 0, entityId: "e-tag", tags: ["urn:tag:xxx"] }),
      makeCandidate({ clientId: "brand", originalIndex: 1, entityId: "brand-9" }),
      makeCandidate({ clientId: "spon", originalIndex: 2, sponsored: true }),
      makeCandidate({ clientId: "clean", originalIndex: 3, entityId: "e-clean" }),
    ];
    const scores = [score("e-tag", 0.4), score("brand-9", 0.3), score("e-clean", 0.2)];
    const ranked = rankCandidates({
      candidates,
      scores,
      profile: profile({
        rules: [
          { kind: "exclude", match: { tagId: "urn:tag:xxx" } },
          { kind: "collapse", match: { brandId: "brand-9" } },
          { kind: "exclude", match: { flag: "sponsored" } },
        ],
      }),
    });
    expect(clientIds(ranked)).toEqual(["tagged", "brand", "clean", "spon"]);
    expect(ranked.find((r) => r.clientId === "tagged")?.ruleEffects).toEqual([
      { kind: "exclude", label: "hidden by your rules" },
    ]);
    expect(ranked.find((r) => r.clientId === "brand")?.ruleEffects).toEqual([
      { kind: "collapse", label: "hidden by your rules" },
    ]);
    expect(ranked.find((r) => r.clientId === "spon")?.ruleEffects).toEqual([
      { kind: "exclude", label: "hidden by your rules" },
    ]);
    expect(ranked.find((r) => r.clientId === "clean")?.ruleEffects).toBeUndefined();
  });

  it("outputs a permutation of the input clientIds and assigns every position", () => {
    const candidates = [
      makeCandidate({ clientId: "a", originalIndex: 0, entityId: "e-a" }),
      makeCandidate({ clientId: "b", originalIndex: 1 }),
      makeCandidate({ clientId: "c", originalIndex: 2, entityId: "e-c", status: "ambiguous" }),
      makeCandidate({ clientId: "d", originalIndex: 3, entityId: "e-d" }),
    ];
    const ranked = rankCandidates({
      candidates,
      scores: [score("e-a", 0.7), score("e-c", 0.9), score("e-d", 0.1)],
      profile: profile(),
    });
    expect([...clientIds(ranked)].sort()).toEqual(["a", "b", "c", "d"]);
    expect(ranked.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it("is pure and deterministic: frozen inputs work and two runs are deep-equal", () => {
    const candidates = deepFreeze([
      makeCandidate({ clientId: "a", originalIndex: 0, entityId: "e-a" }),
      makeCandidate({ clientId: "b", originalIndex: 1, entityId: "e-b" }),
    ]);
    const scores = deepFreeze([score("e-a", 0.4), score("e-b", 0.6)]);
    const prof = deepFreeze(profile({ seeds: [seed("e-b", "B", "dislike")] }));
    const run1 = rankCandidates({ candidates, scores, profile: prof });
    const run2 = rankCandidates({ candidates, scores, profile: prof });
    expect(run1).toEqual(run2);
    expect(clientIds(run1)).toEqual(["a", "b"]);
  });
});
