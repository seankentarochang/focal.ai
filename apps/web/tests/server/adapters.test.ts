import { describe, expect, it, vi } from "vitest";
import type { QlooClient, QlooEntity, ScoredEntity, SearchParams, SearchResult } from "@focal-ai/qloo";
import { toCandidateScores, toCoreEntity, toCoreSearchFn } from "@/lib/server/adapters";

const FUGAZI_ENTITY_ID = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";

const rintaro: QlooEntity = {
  entityId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01",
  name: "Rintaro",
  subtype: "urn:place:restaurant",
  disambiguation: "San Francisco, California",
  popularity: 0.82,
  tagIds: ["urn:tag:place_type:restaurant", "urn:tag:cuisine:japanese"],
  tagNames: ["Restaurant", "Japanese Cuisine"],
  raw: { _fixture: "mock" },
};

const minimal: QlooEntity = {
  entityId: "MIN-1",
  name: "Minimal",
  subtype: "urn:place:restaurant",
  tagIds: [],
  tagNames: [],
  raw: {},
};

describe("toCoreEntity", () => {
  it("maps entityId, name, subtype, disambiguation, popularity, tagIds and tagNames", () => {
    const core = toCoreEntity(rintaro);

    expect(core).toEqual({
      entityId: rintaro.entityId,
      name: "Rintaro",
      subtype: "urn:place:restaurant",
      disambiguation: "San Francisco, California",
      popularity: 0.82,
      tagIds: rintaro.tagIds,
      tagNames: rintaro.tagNames,
    });
    expect("raw" in core).toBe(false);
  });

  it("keeps optional fields absent for a minimal entity", () => {
    const core = toCoreEntity(minimal);

    expect(core.entityId).toBe("MIN-1");
    expect(core.disambiguation).toBeUndefined();
    expect(core.popularity).toBeUndefined();
    expect(core.tagIds).toEqual([]);
    expect(core.tagNames).toEqual([]);
  });
});

describe("toCandidateScores", () => {
  it("maps entityId, affinity, rankIndex, contributions and tagNames", () => {
    const scored: ScoredEntity[] = [
      {
        entity: rintaro,
        affinity: 0.93,
        affinityFoundAt: "query.affinity",
        rankIndex: 0,
        contributions: [{ entityId: FUGAZI_ENTITY_ID, score: 0.44 }],
        explainabilityRaw: {},
      },
    ];

    expect(toCandidateScores(scored)).toEqual([
      {
        entityId: rintaro.entityId,
        affinity: 0.93,
        rankIndex: 0,
        contributions: [{ entityId: FUGAZI_ENTITY_ID, score: 0.44 }],
        tagNames: rintaro.tagNames,
      },
    ]);
  });

  it("carries a missing affinity as undefined", () => {
    const scored: ScoredEntity[] = [{ entity: minimal, rankIndex: 3 }];
    const scores = toCandidateScores(scored);

    expect(scores).toHaveLength(1);
    expect(scores[0]?.entityId).toBe("MIN-1");
    expect(scores[0]?.rankIndex).toBe(3);
    expect(scores[0]?.affinity).toBeUndefined();
    expect(scores[0]?.contributions).toBeUndefined();
    expect(scores[0]?.tagNames).toEqual([]);
  });
});

describe("toCoreSearchFn", () => {
  it("passes query, types, location and take to the client and maps the results", async () => {
    const search = vi.fn(
      async (_params: SearchParams): Promise<SearchResult> => ({
        entities: [rintaro],
        durationMs: 7,
        raw: { _fixture: "mock" },
      }),
    );
    const client = { search } as unknown as QlooClient;
    const fn = toCoreSearchFn(client, 3);

    const entities = await fn({
      query: "Rintaro",
      types: ["urn:place:restaurant"],
      location: "San Francisco",
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({
      query: "Rintaro",
      types: ["urn:place:restaurant"],
      location: "San Francisco",
      take: 3,
    });
    expect(entities).toEqual([toCoreEntity(rintaro)]);
  });

  it("defaults take to 3 and forwards undefined types/location", async () => {
    const search = vi.fn(
      async (_params: SearchParams): Promise<SearchResult> => ({ entities: [], durationMs: 1, raw: {} }),
    );
    const client = { search } as unknown as QlooClient;
    const fn = toCoreSearchFn(client);

    const entities = await fn({ query: "Ghost Place" });

    expect(search).toHaveBeenCalledWith({
      query: "Ghost Place",
      types: undefined,
      location: undefined,
      take: 3,
    });
    expect(entities).toEqual([]);
  });
});
