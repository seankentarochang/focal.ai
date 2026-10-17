import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROFILE_STORAGE_KEY,
  addSeed,
  createEmptyProfile,
  deserializeProfile,
  removeSeed,
  serializeProfile,
  type TasteProfile,
  type TasteSeed,
} from "../src/index";

function seed(overrides: Partial<TasteSeed> = {}): TasteSeed {
  return {
    entityId: "id-1",
    name: "Rintaro",
    subtype: "urn:entity:place",
    disambiguation: "San Francisco, CA",
    polarity: "like",
    weight: 1,
    source: "searched",
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
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

afterEach(() => {
  vi.useRealTimers();
});

describe("profile", () => {
  it("uses the contract storage key and creates a valid empty profile", () => {
    expect(PROFILE_STORAGE_KEY).toBe("focal.profile.v1");
    const p = createEmptyProfile();
    expect(p.version).toBe(1);
    expect(p.seeds).toEqual([]);
    expect(p.rules).toEqual([]);
    expect(new Date(p.updatedAt).toISOString()).toBe(p.updatedAt);
  });

  it("addSeed appends without mutating the input", () => {
    const p0 = deepFreeze(createEmptyProfile());
    const p1 = addSeed(p0, seed());
    expect(p1.seeds).toHaveLength(1);
    expect(p1.seeds[0]?.name).toBe("Rintaro");
    expect(p0.seeds).toHaveLength(0);
  });

  it("dedupes by entityId, replacing polarity/weight/subtype/name and keeping addedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const p0 = addSeed(createEmptyProfile(), seed());
    vi.setSystemTime(new Date("2026-02-02T00:00:00.000Z"));
    const p1 = addSeed(
      p0,
      seed({
        name: "Rintaro (updated)",
        subtype: "urn:entity:destination",
        polarity: "dislike",
        weight: 3,
        addedAt: "2026-02-02T00:00:00.000Z",
      }),
    );
    expect(p1.seeds).toHaveLength(1);
    expect(p1.seeds[0]?.polarity).toBe("dislike");
    expect(p1.seeds[0]?.weight).toBe(3);
    expect(p1.seeds[0]?.name).toBe("Rintaro (updated)");
    expect(p1.seeds[0]?.subtype).toBe("urn:entity:destination");
    expect(p1.seeds[0]?.addedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("bumps updatedAt on mutations", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T00:00:00.000Z"));
    const p0 = createEmptyProfile();
    vi.setSystemTime(new Date("2026-03-03T01:00:00.000Z"));
    const p1 = addSeed(p0, seed());
    expect(p1.updatedAt).toBe("2026-03-03T01:00:00.000Z");
    vi.setSystemTime(new Date("2026-03-03T02:00:00.000Z"));
    const p2 = removeSeed(p1, "id-1");
    expect(p2.updatedAt).toBe("2026-03-03T02:00:00.000Z");
  });

  it("removeSeed removes by entityId and is idempotent, never mutating the input", () => {
    const p0 = deepFreeze(addSeed(addSeed(createEmptyProfile(), seed()), seed({ entityId: "id-2" })));
    const p1 = removeSeed(p0, "id-1");
    expect(p1.seeds.map((s) => s.entityId)).toEqual(["id-2"]);
    const p2 = removeSeed(p1, "id-404");
    expect(p2.seeds.map((s) => s.entityId)).toEqual(["id-2"]);
    expect(p0.seeds).toHaveLength(2);
  });

  it("serialize -> deserialize round-trips deep-equal", () => {
    const profile = addSeed(createEmptyProfile(), seed());
    const json = serializeProfile(profile);
    expect(deserializeProfile(json)).toEqual(profile);
  });

  it("round-trips rules too", () => {
    const profile: TasteProfile = {
      ...createEmptyProfile(),
      rules: [
        { kind: "boost", match: { tagId: "urn:tag:genre:media:jazz" }, weight: 2 },
        { kind: "exclude", match: { flag: "sponsored" } },
        { kind: "collapse", match: { brandId: "brand-1" } },
      ],
    };
    expect(deserializeProfile(serializeProfile(profile))).toEqual(profile);
  });

  it("deserialize throws a clear error on bad JSON", () => {
    expect(() => deserializeProfile("{not json")).toThrowError(/Invalid profile JSON/);
  });

  it("deserialize throws a clear error on a wrong version", () => {
    const p = { ...createEmptyProfile(), version: 2 };
    expect(() => deserializeProfile(JSON.stringify(p))).toThrowError(/Unsupported profile version/);
  });

  it("deserialize throws a clear error on an invalid shape", () => {
    const bad = { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", seeds: [{ entityId: "x" }], rules: [] };
    expect(() => deserializeProfile(JSON.stringify(bad))).toThrowError(/Invalid profile shape/);
    expect(() => deserializeProfile("[]")).toThrowError(/Invalid profile/);
  });

  it("deserialize rejects an invalid polarity value", () => {
    const bad = {
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      seeds: [seed({ polarity: "meh" as unknown as TasteSeed["polarity"] })],
      rules: [],
    };
    expect(() => deserializeProfile(JSON.stringify(bad))).toThrowError(/Invalid profile shape/);
  });
});
