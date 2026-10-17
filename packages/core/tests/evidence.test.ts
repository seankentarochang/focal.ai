import { describe, expect, it } from "vitest";
import { buildReason, type RankedCandidate, type TasteProfile } from "../src/index";

function ranked(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  return {
    clientId: "c1",
    name: "Candidate",
    originalIndex: 0,
    position: 0,
    status: "resolved",
    entity: { entityId: "e-cand", name: "Candidate", subtype: "urn:entity:place" },
    ...overrides,
  };
}

function profile(seeds: { entityId: string; name: string }[]): TasteProfile {
  return {
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    rules: [],
    seeds: seeds.map((s) => ({
      entityId: s.entityId,
      name: s.name,
      subtype: "urn:entity:place",
      polarity: "like" as const,
      weight: 1,
      source: "searched" as const,
      addedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
}

describe("buildReason", () => {
  it("maps the top contribution to a seed name", () => {
    const reason = buildReason(
      ranked({
        scoreMeta: {
          contributions: [{ entityId: "seed-1", score: 0.9 }],
          tagNames: ["Jazz"],
        },
      }),
      profile([{ entityId: "seed-1", name: "Rintaro" }]),
    );
    expect(reason.text).toBe("Matches your taste for Rintaro");
    expect(reason.contributions).toEqual([{ name: "Rintaro", score: 0.9 }]);
    expect(reason.tags).toEqual(["Jazz"]);
  });

  it("cites two contributions with 'and'", () => {
    const reason = buildReason(
      ranked({
        scoreMeta: {
          contributions: [
            { entityId: "seed-1", score: 0.8 },
            { entityId: "seed-2", score: 0.5 },
          ],
        },
      }),
      profile([
        { entityId: "seed-1", name: "Rintaro" },
        { entityId: "seed-2", name: "Bar Part Time" },
      ]),
    );
    expect(reason.text).toBe("Matches your taste for Rintaro and Bar Part Time");
    expect(reason.contributions?.map((c) => c.name)).toEqual(["Rintaro", "Bar Part Time"]);
  });

  it("sorts contributions descending and takes only the top two", () => {
    const reason = buildReason(
      ranked({
        scoreMeta: {
          contributions: [
            { entityId: "seed-3", score: 0.7 },
            { entityId: "seed-1", score: 0.9 },
            { entityId: "seed-2", score: 0.8 },
          ],
        },
      }),
      profile([
        { entityId: "seed-1", name: "A" },
        { entityId: "seed-2", name: "B" },
        { entityId: "seed-3", name: "C" },
      ]),
    );
    expect(reason.text).toBe("Matches your taste for A and B");
    expect(reason.contributions?.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("keeps a contribution scored exactly 0.1 and drops anything below", () => {
    const kept = buildReason(
      ranked({ scoreMeta: { contributions: [{ entityId: "seed-1", score: 0.1 }] } }),
      profile([{ entityId: "seed-1", name: "A" }]),
    );
    expect(kept.text).toBe("Matches your taste for A");

    const dropped = buildReason(
      ranked({ scoreMeta: { contributions: [{ entityId: "seed-1", score: 0.09999 }] } }),
      profile([{ entityId: "seed-1", name: "A" }]),
    );
    expect(dropped.text).toBeUndefined();
  });

  it("skips contribution ids that are not in the profile", () => {
    const reason = buildReason(
      ranked({
        scoreMeta: {
          contributions: [
            { entityId: "unknown-1", score: 0.95 },
            { entityId: "seed-1", score: 0.4 },
          ],
          tagNames: ["Jazz"],
        },
      }),
      profile([{ entityId: "seed-1", name: "Rintaro" }]),
    );
    expect(reason.text).toBe("Matches your taste for Rintaro");
    expect(reason.contributions).toEqual([{ name: "Rintaro", score: 0.4 }]);
  });

  it("returns undefined text (with real tags) when nothing maps — never inventing a reason", () => {
    const reason = buildReason(
      ranked({
        scoreMeta: {
          contributions: [{ entityId: "unknown-1", score: 0.9 }],
          tagNames: ["Jazz", "Cocktails"],
        },
      }),
      profile([{ entityId: "seed-1", name: "Rintaro" }]),
    );
    expect(reason.text).toBeUndefined();
    expect(reason.contributions).toBeUndefined();
    expect(reason.tags).toEqual(["Jazz", "Cocktails"]);
  });

  it("returns undefined text and no tags when scoreMeta is absent", () => {
    const reason = buildReason(ranked(), profile([{ entityId: "seed-1", name: "Rintaro" }]));
    expect(reason.text).toBeUndefined();
    expect(reason.tags).toBeUndefined();
    expect(reason.contributions).toBeUndefined();
  });

  it("cites only names that exist in the profile seeds", () => {
    const reason = buildReason(
      ranked({
        scoreMeta: {
          contributions: [
            { entityId: "seed-1", score: 0.6 },
            { entityId: "unknown-1", score: 0.9 },
          ],
        },
      }),
      profile([
        { entityId: "seed-1", name: "Rintaro" },
        { entityId: "seed-2", name: "Zuni Cafe" },
      ]),
    );
    expect(reason.text).toBe("Matches your taste for Rintaro");
    expect(reason.text).not.toContain("unknown-1");
    expect(reason.contributions).toEqual([{ name: "Rintaro", score: 0.6 }]);
    expect(reason.contributions?.every((c) => c.name === "Rintaro")).toBe(true);
  });
});
