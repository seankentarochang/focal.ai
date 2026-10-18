import entitiesFixture from "../fixtures/entities.json";
import insightsPlacesFixture from "../fixtures/insights-places.json";
import searchFugaziFixture from "../fixtures/search-fugazi.json";
import searchRintaroFixture from "../fixtures/search-rintaro.json";
import tagsNaturalWineFixture from "../fixtures/tags-natural-wine.json";
import { extractResultsArray, extractTagsArray, isRecord, mapEntityList, mapScoredEntity, mapTagList } from "./mapping";
import type {
  InsightsParams,
  InsightsResult,
  QlooClient,
  QlooEntity,
  ScoredEntity,
  SearchParams,
  SearchResult,
  TagSearchResult,
} from "./types";

export const QLOO_FIXTURE_MARKER = searchRintaroFixture._fixture;

const MOCK_DELAY_MS = 50;
const DEFAULT_SEARCH_TAKE = 8;

const SEARCH_FIXTURES: unknown[] = [
  searchRintaroFixture,
  searchFugaziFixture,
  entitiesFixture,
  insightsPlacesFixture,
];

function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectSearchResults(query: string, take: number): unknown[] {
  const normalizedQuery = normalizeMatchText(query);
  if (normalizedQuery.length === 0) return [];
  const results: unknown[] = [];
  const seen = new Set<string>();
  for (const fixture of SEARCH_FIXTURES) {
    for (const value of extractResultsArray(fixture) ?? []) {
      if (!isRecord(value)) continue;
      const entityId = value["entity_id"];
      const name = value["name"];
      if (typeof entityId !== "string" || entityId.length === 0) continue;
      if (typeof name !== "string") continue;
      if (seen.has(entityId)) continue;
      if (!normalizeMatchText(name).includes(normalizedQuery)) continue;
      seen.add(entityId);
      results.push(value);
      if (results.length >= take) return results;
    }
  }
  return results;
}

function selectEntityIds(values: unknown[], entityIds: string[] | undefined): unknown[] {
  if (entityIds === undefined || entityIds.length === 0) return values;
  return values.filter(
    (value) => isRecord(value) && typeof value["entity_id"] === "string" && entityIds.includes(value["entity_id"]),
  );
}

export function createMockQlooClient(): QlooClient {
  async function search(params: SearchParams): Promise<SearchResult> {
    await mockDelay();
    const take = Math.max(1, Math.trunc(params.take ?? DEFAULT_SEARCH_TAKE));
    const payload = {
      _fixture: QLOO_FIXTURE_MARKER,
      success: true,
      results: selectSearchResults(params.query, take),
    };
    return { entities: mapEntityList(payload.results), durationMs: MOCK_DELAY_MS, raw: payload };
  }

  async function insights(params: InsightsParams): Promise<InsightsResult> {
    await mockDelay();
    const values = selectEntityIds(extractResultsArray(insightsPlacesFixture) ?? [], params.resultEntityIds);
    const entities: ScoredEntity[] = [];
    values.forEach((value, rankIndex) => {
      const scored = mapScoredEntity(value, rankIndex);
      if (scored !== undefined) entities.push(scored);
    });
    const result: InsightsResult = { entities, durationMs: MOCK_DELAY_MS, raw: insightsPlacesFixture };
    if (insightsPlacesFixture.query !== undefined) {
      result.aggregateExplainability = insightsPlacesFixture.query;
    }
    return result;
  }

  async function searchTags(_params: { query: string; take?: number }): Promise<TagSearchResult> {
    await mockDelay();
    const values = extractTagsArray(tagsNaturalWineFixture) ?? [];
    return { tags: mapTagList(values), raw: tagsNaturalWineFixture };
  }

  async function getEntities(entityIds: string[]): Promise<{ entities: QlooEntity[]; raw: unknown }> {
    await mockDelay();
    const ids = Array.isArray(entityIds) ? entityIds : [];
    const values = selectEntityIds(extractResultsArray(entitiesFixture) ?? [], ids);
    return { entities: mapEntityList(values), raw: entitiesFixture };
  }

  return { search, insights, searchTags, getEntities };
}
