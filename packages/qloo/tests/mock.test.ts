import { describe, expect, it } from "vitest";
import entitiesFixture from "../fixtures/entities.json";
import insightsPlacesFixture from "../fixtures/insights-places.json";
import searchBrandsFixture from "../fixtures/search-brands.json";
import searchLisbonFixture from "../fixtures/search-lisbon.json";
import { createQlooClient } from "../src/client.js";
import { QLOO_FIXTURE_MARKER, createMockQlooClient } from "../src/mock.js";
import type { InsightsParams } from "../src/types.js";

const FUG = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
const RIN = "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01";
const SBP = "9C4D7E12-5F38-4A61-B7C0-2D8F1E5A9B42";
const ZUNI = "6E1B94D8-3A27-4C85-95F6-7B2E0A4D3C97";
const HOPR = "D5F70A63-8C49-4B1E-A2D8-9E3B6C05F124";
const CHEF = "1B6E38F9-2D54-4F7A-B3E0-C8A5D9142E6B";
const LIS_BAIRRO = "B4E7A1C6-2F59-4D83-9E21-6A08C5D3F764";
const LIS_MEMMO = "C8D2F3A9-6E14-4B75-A3C8-1D92E7B04F00";
const LIS_SANTIAGO = "2F6B9D47-8C31-4E05-B6A9-3E8D0C7F21B4";
const LIS_LUMIARES = "E71C4A86-9D23-4F58-8B60-5C1E9A3D7201";
const BR_AESOP = "A5F2C87E-3B94-4D16-8E70-6F2B9C4A1D83";
const BR_MUJI = "D91E6B34-7A28-4C50-9F3D-2B8E5A0C76F1";
const BR_PATAGONIA = "37C8E5A2-9F46-4B81-A0D5-C31E7B9F2D46";
const BR_FERM_LIVING = "1D8B4E72-9C35-4A68-8F27-3B5E1A0C9D48";
const UNKNOWN = "00000000-0000-0000-0000-000000000000";

function rawMarker(raw: unknown): unknown {
  return (raw as { _fixture?: unknown })._fixture;
}

describe("mock search", () => {
  it("matches a fixture entity by name, maps it, and keeps the marker in raw", async () => {
    const client = createMockQlooClient();
    const result = await client.search({ query: "Rintaro" });

    expect(result.entities).toHaveLength(1);
    expect(result.entities.map((entity) => entity.name)).toEqual(["Rintaro"]);
    expect(result.entities[0]?.entityId).toBe(RIN);
    expect(result.entities[0]?.subtype).toBe("urn:entity:place");
    expect(result.entities[0]?.disambiguation).toBe("San Francisco, California");
    expect(result.entities[0]?.tagIds).toContain("urn:tag:venue_style:izakaya");
    expect(rawMarker(result.raw)).toBe(QLOO_FIXTURE_MARKER);
  });

  it("matches the fixture marker string exactly", () => {
    expect(QLOO_FIXTURE_MARKER).toBe("mock — hand-authored from public docs examples, not live Qloo data");
  });

  it("keeps the fixture marker on the Atlas and Verve fixtures", () => {
    expect(searchLisbonFixture._fixture).toBe(QLOO_FIXTURE_MARKER);
    expect(searchBrandsFixture._fixture).toBe(QLOO_FIXTURE_MARKER);
  });

  it("matches case-insensitively on substrings of the entity name", async () => {
    const client = createMockQlooClient();
    const upper = await client.search({ query: "  RINTARO " });

    expect(upper.entities.map((entity) => entity.entityId)).toEqual([RIN]);

    const substring = await client.search({ query: "bird provisions" });

    expect(substring.entities.map((entity) => entity.name)).toEqual(["State Bird Provisions"]);
  });

  it("dedupes entities that appear in several fixtures and respects take", async () => {
    const client = createMockQlooClient();

    const deduped = await client.search({ query: "zuni" });
    expect(deduped.entities.map((entity) => entity.entityId)).toEqual([ZUNI]);

    const broad = await client.search({ query: "a" });
    expect(broad.entities).toHaveLength(8);
    expect(broad.entities.slice(0, 4).map((entity) => entity.entityId)).toEqual([RIN, SBP, ZUNI, FUG]);

    const capped = await client.search({ query: "a", take: 2 });
    expect(capped.entities.map((entity) => entity.entityId)).toEqual([RIN, SBP]);
  });

  it("returns the Fugazi fixture for a Fugazi query", async () => {
    const client = createMockQlooClient();
    const result = await client.search({ query: "Fugazi" });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.name).toBe("Fugazi");
    expect(result.entities[0]?.disambiguation).toBe("Washington, D.C.");
    expect(result.entities[0]?.subtype).toBe("urn:entity:artist");
  });

  it("resolves Lisbon hotels for the Atlas demo page", async () => {
    const client = createMockQlooClient();

    const alfama = await client.search({ query: "alfama" });
    expect(alfama.entities.map((entity) => entity.entityId)).toEqual([LIS_MEMMO, LIS_SANTIAGO]);
    expect(rawMarker(alfama.raw)).toBe(QLOO_FIXTURE_MARKER);

    const memmo = alfama.entities[0]!;
    expect(memmo.name).toBe("Memmo Alfama");
    expect(memmo.subtype).toBe("urn:entity:place");
    expect(memmo.disambiguation).toBe("Lisbon, Portugal");
    expect(memmo.tagIds).toContain("urn:tag:place_type:hotel");
    expect(memmo.tagIds).toContain("urn:tag:neighborhood:alfama");
    expect(memmo.properties?.geocode).toEqual({ city: "Lisbon", country_code: "PT" });

    const bairro = await client.search({ query: "bairro alto" });
    expect(bairro.entities.map((entity) => entity.entityId)).toEqual([LIS_BAIRRO]);
    expect(bairro.entities[0]?.properties?.city).toBe("Lisbon");

    const lumiares = await client.search({ query: "lumiares" });
    expect(lumiares.entities.map((entity) => entity.entityId)).toEqual([LIS_LUMIARES]);
  });

  it("resolves brands for the Verve demo page", async () => {
    const client = createMockQlooClient();

    const aesop = await client.search({ query: "Aesop" });
    expect(aesop.entities).toHaveLength(1);
    expect(aesop.entities[0]?.entityId).toBe(BR_AESOP);
    expect(aesop.entities[0]?.subtype).toBe("urn:entity:brand");
    expect(aesop.entities[0]?.disambiguation).toBe("Melbourne, Australia");
    expect(aesop.entities[0]?.tagIds).toContain("urn:tag:style:minimalist");
    expect(rawMarker(aesop.raw)).toBe(QLOO_FIXTURE_MARKER);

    const muji = await client.search({ query: "muji" });
    expect(muji.entities.map((entity) => entity.entityId)).toEqual([BR_MUJI]);
    expect(muji.entities[0]?.subtype).toBe("urn:entity:brand");
  });

  it("returns an empty envelope for unknown queries", async () => {
    const client = createMockQlooClient();
    const result = await client.search({ query: "gibberish" });

    expect(result.entities).toHaveLength(0);
    expect(rawMarker(result.raw)).toBe(QLOO_FIXTURE_MARKER);
  });

  it("ignores location and type params (fixtures are fixed)", async () => {
    const client = createMockQlooClient();
    const plain = await client.search({ query: "Rintaro" });
    const constrained = await client.search({
      query: "Rintaro",
      types: ["urn:entity:brand"],
      location: "Reykjavík",
      take: 1,
    });

    expect(constrained.entities.map((entity) => entity.entityId)).toEqual(
      plain.entities.map((entity) => entity.entityId),
    );
  });
});

describe("mock insights", () => {
  it("serves the insights fixture and populates affinity via the shared mapping", async () => {
    const client = createMockQlooClient();
    const result = await client.insights({ resultType: "urn:entity:place", signalEntityIds: [FUG, RIN] });

    expect(result.entities).toHaveLength(5);
    const rintaro = result.entities[0]!;
    expect(rintaro.entity.entityId).toBe(RIN);
    expect(rintaro.affinity).toBe(0.93);
    expect(rintaro.affinityFoundAt).toBe("query.affinity");
    expect(rintaro.contributions).toEqual([{ entityId: FUG, score: 0.44 }]);

    const primeRib = result.entities.find((scored) => scored.entity.entityId === HOPR);
    expect(primeRib?.affinity).toBe(0.57);
    expect(primeRib?.affinityFoundAt).toBe("query.measurements.affinity");

    const cheFico = result.entities.find((scored) => scored.entity.entityId === CHEF);
    expect(cheFico?.affinity).toBeUndefined();

    expect(result.aggregateExplainability).toEqual(insightsPlacesFixture.query);
    expect(rawMarker(result.raw)).toBe(QLOO_FIXTURE_MARKER);
  });

  it("filters to resultEntityIds in fixture order with renumbered rankIndex", async () => {
    const client = createMockQlooClient();
    const result = await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG],
      resultEntityIds: [ZUNI, RIN],
    });

    expect(result.entities).toHaveLength(2);
    expect(result.entities.map((scored) => scored.entity.entityId)).toEqual([RIN, ZUNI]);
    expect(result.entities.map((scored) => scored.rankIndex)).toEqual([0, 1]);
    expect(result.entities[0]?.affinity).toBe(0.93);
    expect(result.entities[1]?.affinity).toBe(0.64);
  });

  it("returns an empty entity list when no requested id matches the fixture", async () => {
    const client = createMockQlooClient();
    const result = await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG],
      resultEntityIds: [UNKNOWN],
    });

    expect(result.entities).toHaveLength(0);
  });

  it("ignores the explainability param", async () => {
    const client = createMockQlooClient();
    const withExplainability = await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG],
      explainability: true,
    });
    const withoutExplainability = await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG],
      explainability: false,
    });

    expect(withoutExplainability.entities.map((scored) => scored.entity.entityId)).toEqual(
      withExplainability.entities.map((scored) => scored.entity.entityId),
    );
    expect(withoutExplainability.entities[0]?.contributions).toEqual(withExplainability.entities[0]?.contributions);
  });
});

describe("mock insights synthesis", () => {
  it("synthesizes deterministic Lisbon affinities within 0.58..0.94", async () => {
    const client = createMockQlooClient();
    const params: InsightsParams = {
      resultType: "urn:entity:place",
      signalEntityIds: [FUG],
      resultEntityIds: [LIS_BAIRRO, LIS_MEMMO, LIS_SANTIAGO, LIS_LUMIARES],
    };
    const first = await client.insights(params);
    const second = await client.insights(params);

    expect(second.entities).toEqual(first.entities);
    expect(first.entities.map((scored) => scored.entity.entityId)).toEqual([
      LIS_BAIRRO,
      LIS_MEMMO,
      LIS_SANTIAGO,
      LIS_LUMIARES,
    ]);
    expect(first.entities.map((scored) => scored.rankIndex)).toEqual([0, 1, 2, 3]);
    for (const scored of first.entities) {
      expect(scored.affinity).toBeGreaterThanOrEqual(0.58);
      expect(scored.affinity).toBeLessThanOrEqual(0.94);
      expect(scored.affinityFoundAt).toBe("query.affinity");
      expect(scored.entity.tagIds).toContain("urn:tag:place_type:hotel");
    }
    expect(first.entities.map((scored) => scored.affinity)).toEqual([0.68, 0.67, 0.61, 0.75]);
    expect(first.entities[0]?.contributions).toBeUndefined();
    expect(first.entities[1]?.contributions).toEqual([{ entityId: FUG, score: 0.37 }]);
    expect(first.entities[2]?.contributions).toBeUndefined();
    expect(first.entities[3]?.contributions).toEqual([{ entityId: FUG, score: 0.37 }]);
    expect(rawMarker(first.raw)).toBe(QLOO_FIXTURE_MARKER);
  });

  it("synthesizes brand affinities for the Verve fixture", async () => {
    const client = createMockQlooClient();
    const result = await client.insights({
      resultType: "urn:entity:brand",
      signalEntityIds: [FUG],
      resultEntityIds: [BR_AESOP, BR_MUJI, BR_PATAGONIA, BR_FERM_LIVING],
    });

    expect(result.entities.map((scored) => scored.entity.entityId)).toEqual([
      BR_AESOP,
      BR_MUJI,
      BR_PATAGONIA,
      BR_FERM_LIVING,
    ]);
    expect(result.entities.map((scored) => scored.entity.subtype)).toEqual([
      "urn:entity:brand",
      "urn:entity:brand",
      "urn:entity:brand",
      "urn:entity:brand",
    ]);
    expect(result.entities.map((scored) => scored.affinity)).toEqual([0.85, 0.91, 0.8, 0.76]);
    expect(result.entities[0]?.contributions).toEqual([{ entityId: FUG, score: 0.21 }]);
    expect(result.entities[1]?.contributions).toBeUndefined();
    expect(result.entities[0]?.entity.tagIds).toContain("urn:tag:style:minimalist");
  });

  it("keeps fixture values winning and appends synthesized entries after them", async () => {
    const client = createMockQlooClient();
    const result = await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG],
      resultEntityIds: [LIS_MEMMO, RIN, UNKNOWN, ZUNI],
    });

    expect(result.entities.map((scored) => scored.entity.entityId)).toEqual([RIN, ZUNI, LIS_MEMMO]);
    expect(result.entities.map((scored) => scored.rankIndex)).toEqual([0, 1, 2]);
    expect(result.entities[0]?.affinity).toBe(0.93);
    expect(result.entities[0]?.contributions).toEqual([{ entityId: FUG, score: 0.44 }]);
    expect(result.entities[1]?.affinity).toBe(0.64);
    expect(result.entities[2]?.affinity).toBe(0.67);
    expect(result.entities[2]?.affinityFoundAt).toBe("query.affinity");
  });

  it("synthesizes for the Fugazi signal id itself", async () => {
    const client = createMockQlooClient();
    const result = await client.insights({
      resultType: "urn:entity:artist",
      signalEntityIds: [FUG],
      resultEntityIds: [FUG],
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.entity.entityId).toBe(FUG);
    expect(result.entities[0]?.affinity).toBe(0.74);
    expect(result.entities[0]?.affinityFoundAt).toBe("query.affinity");
    expect(result.entities[0]?.contributions).toBeUndefined();
  });
});

describe("mock tags, entities, and delay", () => {
  it("serves the natural-wine tags fixture", async () => {
    const client = createMockQlooClient();
    const result = await client.searchTags({ query: "natural wine" });

    expect(result.tags).toHaveLength(3);
    expect(result.tags.map((tag) => tag.id)).toEqual([
      "urn:tag:cuisine:natural_wine",
      "urn:tag:beverage:orange_wine",
      "urn:tag:beverage:low_intervention_wine",
    ]);
    expect(rawMarker(result.raw)).toBe(QLOO_FIXTURE_MARKER);
  });

  it("serves entities filtered by requested ids, preserving fixture order", async () => {
    const client = createMockQlooClient();

    const both = await client.getEntities([FUG, RIN]);
    expect(both.entities.map((entity) => entity.entityId)).toEqual([RIN, FUG]);
    expect(both.raw).toEqual(entitiesFixture);

    const one = await client.getEntities([FUG]);
    expect(one.entities).toHaveLength(1);
    expect(one.entities[0]?.name).toBe("Fugazi");

    const all = await client.getEntities([]);
    expect(all.entities).toHaveLength(2);
  });

  it("applies the artificial delay on every call", async () => {
    const client = createMockQlooClient();
    const startedAt = Date.now();

    await client.search({ query: "Rintaro" });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
  });

  it("is reachable through createQlooClient({ mock: true }) without an API key", async () => {
    const client = createQlooClient({ mock: true });
    const result = await client.search({ query: "Rintaro" });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.entityId).toBe(RIN);
    expect(rawMarker(result.raw)).toBe(QLOO_FIXTURE_MARKER);
  });
});
