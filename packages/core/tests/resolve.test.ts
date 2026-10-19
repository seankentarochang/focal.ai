import { describe, expect, it } from "vitest";
import { normalizeName, resolveCandidates, type CoreEntity, type CoreSearchFn } from "../src/index";

function entity(overrides: Partial<CoreEntity> & { entityId: string; name: string }): CoreEntity {
  return { subtype: "urn:entity:place", ...overrides };
}

function candidate(name: string, overrides: Record<string, unknown> = {}) {
  return { clientId: `c-${name}`, name, originalIndex: 0, ...overrides };
}

function searchFrom(map: Record<string, CoreEntity[]>, calls: unknown[] = []): CoreSearchFn {
  return async (args) => {
    calls.push(args);
    return map[args.query] ?? [];
  };
}

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation, collapses whitespace", () => {
    expect(normalizeName("Zuni Café")).toBe("zuni cafe");
    expect(normalizeName("  Rintaro  ")).toBe("rintaro");
    expect(normalizeName("Bar Part-Time & Co.")).toBe("bar part time co");
    expect(normalizeName("STATE BIRD")).toBe("state bird");
  });
});

describe("resolveCandidates", () => {
  it("resolves an exact normalized match (diacritics/case insensitive)", async () => {
    const search = searchFrom({
      "Zuni Café": [entity({ entityId: "zuni-1", name: "Zuni Cafe", disambiguation: "San Francisco, CA" })],
    });
    const [r] = await resolveCandidates([candidate("Zuni Café")], search, "urn:entity:place");
    expect(r?.status).toBe("resolved");
    expect(r?.entity?.entityId).toBe("zuni-1");
  });

  it("keeps the client's own location and passes it to search", async () => {
    const calls: unknown[] = [];
    const search = searchFrom(
      { Rintaro: [entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" })] },
      calls,
    );
    await resolveCandidates(
      [candidate("Rintaro", { locationText: "San Francisco" })],
      search,
      "urn:entity:place",
    );
    expect(calls[0]).toEqual({ query: "Rintaro", types: ["urn:entity:place"], location: "San Francisco" });
  });

  it("marks a city mismatch ambiguous — the chain-in-the-wrong-city case", async () => {
    const search = searchFrom({
      Rintaro: [entity({ entityId: "ny-1", name: "Rintaro", disambiguation: "New York, NY" })],
    });
    const [r] = await resolveCandidates(
      [candidate("Rintaro", { locationText: "San Francisco" })],
      search,
      "urn:entity:place",
    );
    expect(r?.status).toBe("ambiguous");
    expect(r?.entity?.entityId).toBe("ny-1");
  });

  it("resolves when the disambiguation contains a city token", async () => {
    const search = searchFrom({
      Rintaro: [entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" })],
    });
    const [r] = await resolveCandidates(
      [candidate("Rintaro", { locationText: "San Francisco" })],
      search,
      "urn:entity:place",
    );
    expect(r?.status).toBe("resolved");
  });

  it("does not resolve on short city tokens (fewer than 3 chars)", async () => {
    const search = searchFrom({
      Rintaro: [entity({ entityId: "la-1", name: "Rintaro", disambiguation: "Los Angeles, CA" })],
    });
    const [r] = await resolveCandidates(
      [candidate("Rintaro", { locationText: "LA" })],
      search,
      "urn:entity:place",
    );
    expect(r?.status).toBe("ambiguous");
  });

  it("respects defaults.location when the candidate has no locationText", async () => {
    const calls: unknown[] = [];
    const search = searchFrom(
      { Rintaro: [entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" })] },
      calls,
    );
    const [r] = await resolveCandidates([candidate("Rintaro")], search, "urn:entity:place", {
      location: "San Francisco",
    });
    expect(calls[0]).toEqual({ query: "Rintaro", types: ["urn:entity:place"], location: "San Francisco" });
    expect(r?.status).toBe("resolved");
  });

  it("marks a startsWith-only match ambiguous", async () => {
    const search = searchFrom({
      Zuni: [entity({ entityId: "zuni-1", name: "Zuni Cafe" })],
    });
    const [r] = await resolveCandidates([candidate("Zuni")], search, "urn:entity:place");
    expect(r?.status).toBe("ambiguous");
    expect(r?.entity?.entityId).toBe("zuni-1");
  });

  it("marks the reverse startsWith direction ambiguous too", async () => {
    const search = searchFrom({
      "Rintaro Izakaya": [entity({ entityId: "sf-1", name: "Rintaro" })],
    });
    const [r] = await resolveCandidates([candidate("Rintaro Izakaya")], search, "urn:entity:place");
    expect(r?.status).toBe("ambiguous");
  });

  it("prefers an exact match over a startsWith sibling when no context exists", async () => {
    const search = searchFrom({
      Rintaro: [
        entity({ entityId: "izakaya", name: "Rintaro Izakaya" }),
        entity({ entityId: "exact", name: "Rintaro" }),
      ],
    });
    const [r] = await resolveCandidates([candidate("Rintaro")], search, "urn:entity:place");
    expect(r?.status).toBe("resolved");
    expect(r?.entity?.entityId).toBe("exact");
  });

  it("marks duplicate normalized-equal names with different ids ambiguous", async () => {
    const search = searchFrom({
      Rintaro: [
        entity({ entityId: "sf-1", name: "Rintaro" }),
        entity({ entityId: "sf-2", name: "rintaro" }),
      ],
    });
    const [r] = await resolveCandidates([candidate("Rintaro")], search, "urn:entity:place", {
      location: "San Francisco",
    });
    expect(r?.status).toBe("ambiguous");
    expect(r?.entity?.entityId).toBe("sf-1");
  });

  it("resolves duplicate names when exactly one city match exists", async () => {
    const search = searchFrom({
      Rintaro: [
        entity({ entityId: "ny-1", name: "Rintaro", disambiguation: "New York, NY" }),
        entity({ entityId: "la-1", name: "Rintaro", disambiguation: "Los Angeles, CA" }),
        entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" }),
      ],
    });
    const [r] = await resolveCandidates(
      [candidate("Rintaro", { locationText: "San Francisco" })],
      search,
      "urn:entity:place",
    );
    expect(r?.status).toBe("resolved");
    expect(r?.entity?.entityId).toBe("sf-1");
  });

  it("marks duplicate names ambiguous when no city match exists", async () => {
    const search = searchFrom({
      Rintaro: [
        entity({ entityId: "ny-1", name: "Rintaro", disambiguation: "New York, NY" }),
        entity({ entityId: "la-1", name: "Rintaro", disambiguation: "Los Angeles, CA" }),
      ],
    });
    const [r] = await resolveCandidates(
      [candidate("Rintaro", { locationText: "San Francisco" })],
      search,
      "urn:entity:place",
    );
    expect(r?.status).toBe("ambiguous");
    expect(r?.entity?.entityId).toBe("ny-1");
  });

  it("marks duplicate names ambiguous when two city matches exist", async () => {
    const search = searchFrom({
      Rintaro: [
        entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" }),
        entity({ entityId: "sf-2", name: "Rintaro", disambiguation: "San Francisco, CA" }),
        entity({ entityId: "ny-1", name: "Rintaro", disambiguation: "New York, NY" }),
      ],
    });
    const [r] = await resolveCandidates(
      [candidate("Rintaro", { locationText: "San Francisco" })],
      search,
      "urn:entity:place",
    );
    expect(r?.status).toBe("ambiguous");
    expect(r?.entity?.entityId).toBe("sf-1");
  });

  it("prefers a city match over a higher-ranked non-city result", async () => {
    const search = searchFrom({
      Rintaro: [
        entity({ entityId: "ny-1", name: "Rintaro", disambiguation: "New York, NY" }),
        entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" }),
      ],
    });
    const [r] = await resolveCandidates(
      [candidate("Rintaro", { locationText: "San Francisco" })],
      search,
      "urn:entity:place",
    );
    expect(r?.status).toBe("resolved");
    expect(r?.entity?.entityId).toBe("sf-1");
  });

  it("returns unresolved when search returns nothing", async () => {
    const search = searchFrom({});
    const [r] = await resolveCandidates([candidate("Ghost Place")], search, "urn:entity:place");
    expect(r?.status).toBe("unresolved");
    expect(r?.entity).toBeUndefined();
  });

  it("ignores results whose subtype does not equal expectedType", async () => {
    const search = searchFrom({
      Aesop: [entity({ entityId: "brand-1", name: "Aesop", subtype: "urn:entity:brand" })],
    });
    const [r] = await resolveCandidates([candidate("Aesop")], search, "urn:entity:place");
    expect(r?.status).toBe("unresolved");
    expect(r?.entity).toBeUndefined();
  });

  it("preserves input order and resolves each candidate independently", async () => {
    const search = searchFrom({
      One: [entity({ entityId: "one", name: "One" })],
      Three: [entity({ entityId: "three", name: "Three", disambiguation: "Lisbon, Portugal" })],
    });
    const results = await resolveCandidates(
      [
        candidate("One", { clientId: "c1", originalIndex: 0 }),
        candidate("Two", { clientId: "c2", originalIndex: 1 }),
        candidate("Three", { clientId: "c3", originalIndex: 2, locationText: "Lisbon" }),
      ],
      search,
      "urn:entity:place",
    );
    expect(results.map((r) => r.clientId)).toEqual(["c1", "c2", "c3"]);
    expect(results.map((r) => r.status)).toEqual(["resolved", "unresolved", "resolved"]);
    expect(results.map((r) => r.originalIndex)).toEqual([0, 1, 2]);
  });

  it("is deterministic: same input, same output", async () => {
    const search = searchFrom({
      Rintaro: [entity({ entityId: "sf-1", name: "Rintaro", disambiguation: "San Francisco, CA" })],
    });
    const input = [candidate("Rintaro", { locationText: "San Francisco" })];
    const a = await resolveCandidates(input, search, "urn:entity:place");
    const b = await resolveCandidates(input, search, "urn:entity:place");
    expect(a).toEqual(b);
  });
});
