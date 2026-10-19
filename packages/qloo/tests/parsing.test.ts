import { describe, expect, it } from "vitest";
import entitiesFixture from "../fixtures/entities.json";
import insightsPlacesFixture from "../fixtures/insights-places.json";
import searchRintaroFixture from "../fixtures/search-rintaro.json";
import tagsNaturalWineFixture from "../fixtures/tags-natural-wine.json";
import { QlooError } from "../src/errors.js";
import type { ScoredEntity } from "../src/types.js";
import { createFetchSpy, createLiveClient, jsonResponse, rejection } from "./support.js";

const FUG = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
const RIN = "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01";
const SBP = "9C4D7E12-5F38-4A61-B7C0-2D8F1E5A9B42";
const ZUNI = "6E1B94D8-3A27-4C85-95F6-7B2E0A4D3C97";
const HOPR = "D5F70A63-8C49-4B1E-A2D8-9E3B6C05F124";
const CHEF = "1B6E38F9-2D54-4F7A-B3E0-C8A5D9142E6B";

function serve(payload: unknown) {
  return createFetchSpy(async () => jsonResponse(payload));
}

function byEntityId(entities: ScoredEntity[], entityId: string): ScoredEntity {
  const found = entities.find((scored) => scored.entity.entityId === entityId);
  if (found === undefined) throw new Error(`entity ${entityId} not found`);
  return found;
}

describe("search parsing", () => {
  it("parses the Rintaro fixture into mapped entities with raw intact", async () => {
    const client = createLiveClient(serve(searchRintaroFixture));
    const result = await client.search({ query: "Rintaro" });

    expect(result.entities).toHaveLength(3);
    expect(result.entities.map((entity) => entity.name)).toEqual(["Rintaro", "State Bird Provisions", "Zuni Café"]);
    const rintaro = result.entities[0]!;
    expect(rintaro.entityId).toBe(RIN);
    expect(rintaro.subtype).toBe("urn:entity:place");
    expect(rintaro.disambiguation).toBe("San Francisco, California");
    expect(rintaro.popularity).toBe(0.82);
    expect(rintaro.tagIds).toContain("urn:tag:cuisine:japanese");
    expect(rintaro.tagNames).toContain("Izakaya");
    expect(result.raw).toEqual(searchRintaroFixture);
    expect(typeof result.durationMs).toBe("number");
  });

  it("skips malformed search entries without throwing", async () => {
    const client = createLiveClient(
      serve({
        success: true,
        results: [{ name: "No Id" }, "not-an-object", null, { entity_id: "e-ok", name: "Good" }],
      }),
    );
    const result = await client.search({ query: "x" });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.entityId).toBe("e-ok");
  });

  it("falls back to types[0] for subtype and reads tag_id on live search shapes", async () => {
    const client = createLiveClient(
      serve({
        success: true,
        results: [
          {
            entity_id: "e-live",
            name: "Rintaro",
            types: ["urn:entity:place"],
            tags: [{ name: "Izakaya", tag_id: "urn:tag:venue_style:izakaya" }],
          },
        ],
      }),
    );
    const result = await client.search({ query: "Rintaro" });

    expect(result.entities[0]?.subtype).toBe("urn:entity:place");
    expect(result.entities[0]?.tagIds).toEqual(["urn:tag:venue_style:izakaya"]);
    expect(result.entities[0]?.tagNames).toEqual(["Izakaya"]);
  });

  it("throws PARSE when a 2xx search payload has no results array", async () => {
    const client = createLiveClient(serve({ success: true }));
    const error = await rejection(client.search({ query: "x" }));

    expect(error).toBeInstanceOf(QlooError);
    expect(error.code).toBe("PARSE");
  });
});

describe("insights parsing", () => {
  it("extracts affinity, contributions, and aggregate explainability from the fixture", async () => {
    const client = createLiveClient(serve(insightsPlacesFixture));
    const result = await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG, RIN],
      explainability: true,
    });

    expect(result.entities).toHaveLength(5);
    expect(result.entities.map((scored) => scored.rankIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(result.raw).toEqual(insightsPlacesFixture);
    expect(result.aggregateExplainability).toEqual(insightsPlacesFixture.query);

    const rintaro = byEntityId(result.entities, RIN);
    expect(rintaro.affinity).toBe(0.93);
    expect(rintaro.affinityFoundAt).toBe("query.affinity");
    expect(rintaro.contributions).toEqual([{ entityId: FUG, score: 0.44 }]);
    expect(rintaro.explainabilityRaw).toEqual({ contributions: [{ entity_id: FUG, score: 0.44 }] });
  });

  it("extracts live signal.interests.entities explainability contributions", async () => {
    const client = createLiveClient(
      serve({
        success: true,
        results: {
          entities: [
            {
              entity_id: "e-live",
              name: "Rintaro",
              subtype: "urn:entity:place",
              query: {
                affinity: 0.75,
                explainability: {
                  "signal.interests.entities": [
                    { entity_id: FUG, score: 1 },
                    { entity_id: RIN, score: 0.5 },
                  ],
                },
              },
            },
          ],
        },
      }),
    );
    const result = await client.insights({ resultType: "urn:entity:place", signalEntityIds: [FUG] });

    expect(result.entities[0]?.contributions).toEqual([
      { entityId: FUG, score: 1 },
      { entityId: RIN, score: 0.5 },
    ]);
    expect(result.entities[0]?.explainabilityRaw).toEqual({
      "signal.interests.entities": [
        { entity_id: FUG, score: 1 },
        { entity_id: RIN, score: 0.5 },
      ],
    });
  });

  it("records query.measurements.affinity as the fallback path", async () => {
    const client = createLiveClient(serve(insightsPlacesFixture));
    const result = await client.insights({ resultType: "urn:entity:place", signalEntityIds: [FUG] });

    const primeRib = byEntityId(result.entities, HOPR);
    expect(primeRib.affinity).toBe(0.57);
    expect(primeRib.affinityFoundAt).toBe("query.measurements.affinity");
    expect(primeRib.contributions).toBeUndefined();
  });

  it("leaves affinity undefined when neither path is present", async () => {
    const client = createLiveClient(serve(insightsPlacesFixture));
    const result = await client.insights({ resultType: "urn:entity:place", signalEntityIds: [FUG] });

    const cheFico = byEntityId(result.entities, CHEF);
    expect(cheFico.affinity).toBeUndefined();
    expect(cheFico.affinityFoundAt).toBeUndefined();
    expect(cheFico.contributions).toBeUndefined();
    expect(cheFico.explainabilityRaw).toBeUndefined();
  });

  it("extracts multi-contribution explainability for State Bird and Zuni", async () => {
    const client = createLiveClient(serve(insightsPlacesFixture));
    const result = await client.insights({ resultType: "urn:entity:place", signalEntityIds: [FUG, RIN] });

    expect(byEntityId(result.entities, SBP).contributions).toEqual([
      { entityId: FUG, score: 0.31 },
      { entityId: RIN, score: 0.22 },
    ]);
    expect(byEntityId(result.entities, SBP).affinityFoundAt).toBe("query.affinity");
    expect(byEntityId(result.entities, ZUNI).contributions).toEqual([{ entityId: RIN, score: 0.37 }]);
    expect(byEntityId(result.entities, ZUNI).affinity).toBe(0.64);
  });

  it("falls through a non-numeric query.affinity to query.measurements.affinity", async () => {
    const client = createLiveClient(
      serve({
        success: true,
        results: {
          entities: [
            {
              entity_id: "e-1",
              name: "Fallback",
              query: { affinity: "0.99", measurements: { affinity: 0.42 } },
            },
          ],
        },
      }),
    );
    const result = await client.insights({ resultType: "urn:entity:place", signalEntityIds: ["s1"] });

    expect(result.entities[0]?.affinity).toBe(0.42);
    expect(result.entities[0]?.affinityFoundAt).toBe("query.measurements.affinity");
  });

  it("skips malformed insights entries (missing entity_id) without throwing", async () => {
    const client = createLiveClient(
      serve({
        success: true,
        results: { entities: [{ name: "No Id" }, { entity_id: "e-ok", name: "Good", query: { affinity: 0.5 } }] },
      }),
    );
    const result = await client.insights({ resultType: "urn:entity:place", signalEntityIds: ["s1"] });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.entity.entityId).toBe("e-ok");
    expect(result.entities[0]?.affinity).toBe(0.5);
  });
});

describe("tags and entities parsing", () => {
  it("parses the natural-wine tags fixture", async () => {
    const client = createLiveClient(serve(tagsNaturalWineFixture));
    const result = await client.searchTags({ query: "natural wine" });

    expect(result.tags).toHaveLength(3);
    expect(result.tags[0]).toEqual({
      id: "urn:tag:cuisine:natural_wine",
      name: "Natural Wine",
      subtype: "urn:tag_type:cuisine",
    });
    expect(result.raw).toEqual(tagsNaturalWineFixture);
  });

  it("parses the entities fixture", async () => {
    const client = createLiveClient(serve(entitiesFixture));
    const result = await client.getEntities([RIN, FUG]);

    expect(result.entities).toHaveLength(2);
    expect(result.entities.map((entity) => entity.entityId)).toEqual([RIN, FUG]);
    expect(result.entities[1]?.name).toBe("Fugazi");
    expect(result.raw).toEqual(entitiesFixture);
  });
});
