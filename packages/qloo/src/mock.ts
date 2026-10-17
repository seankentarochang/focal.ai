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

function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
}

function emptyResultsEnvelope(): unknown {
  return { _fixture: QLOO_FIXTURE_MARKER, success: true, results: [] as unknown[] };
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
    const query = params.query.toLowerCase();
    const payload = query.includes("rintaro")
      ? searchRintaroFixture
      : query.includes("fugazi")
        ? searchFugaziFixture
        : emptyResultsEnvelope();
    const values = extractResultsArray(payload) ?? [];
    return { entities: mapEntityList(values), durationMs: MOCK_DELAY_MS, raw: payload };
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
