import { describe, expect, it } from "vitest";
import entitiesFixture from "../fixtures/entities.json";
import insightsPlacesFixture from "../fixtures/insights-places.json";
import { createQlooClient } from "../src/client.js";
import { QLOO_FIXTURE_MARKER, createMockQlooClient } from "../src/mock.js";

const FUG = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
const RIN = "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01";
const ZUNI = "6E1B94D8-3A27-4C85-95F6-7B2E0A4D3C97";
const HOPR = "D5F70A63-8C49-4B1E-A2D8-9E3B6C05F124";
const CHEF = "1B6E38F9-2D54-4F7A-B3E0-C8A5D9142E6B";

function rawMarker(raw: unknown): unknown {
  return (raw as { _fixture?: unknown })._fixture;
}

describe("mock search", () => {
  it("returns the Rintaro fixture entities with the marker intact in raw", async () => {
    const client = createMockQlooClient();
    const result = await client.search({ query: "Rintaro" });

    expect(result.entities).toHaveLength(3);
    expect(result.entities.map((entity) => entity.name)).toEqual(["Rintaro", "State Bird Provisions", "Zuni Café"]);
    expect(result.entities[0]?.disambiguation).toBe("San Francisco, California");
    expect(result.entities[0]?.tagIds).toContain("urn:tag:venue_style:izakaya");
    expect(rawMarker(result.raw)).toBe(QLOO_FIXTURE_MARKER);
  });

  it("matches the fixture marker string exactly", () => {
    expect(QLOO_FIXTURE_MARKER).toBe("mock — hand-authored from public docs examples, not live Qloo data");
  });

  it("matches Rintaro case-insensitively and inside a longer query", async () => {
    const client = createMockQlooClient();
    const result = await client.search({ query: "best rintaro ramen" });

    expect(result.entities).toHaveLength(3);
    expect(result.entities[0]?.entityId).toBe(RIN);
  });

  it("returns the Fugazi fixture for a Fugazi query", async () => {
    const client = createMockQlooClient();
    const result = await client.search({ query: "Fugazi" });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.name).toBe("Fugazi");
    expect(result.entities[0]?.disambiguation).toBe("Washington, D.C.");
    expect(result.entities[0]?.subtype).toBe("urn:artist:musical_artist");
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
      resultEntityIds: ["00000000-0000-0000-0000-000000000000"],
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

    expect(result.entities).toHaveLength(3);
    expect(rawMarker(result.raw)).toBe(QLOO_FIXTURE_MARKER);
  });
});
