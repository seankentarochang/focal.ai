import type { QlooEntity, ScoreContribution, ScoredEntity, TagSearchResult } from "./types";

export const AFFINITY_PATHS: { path: string; read: (query: Record<string, unknown>) => unknown }[] = [
  { path: "query.affinity", read: (query) => query["affinity"] },
  {
    path: "query.measurements.affinity",
    read: (query) => {
      const measurements = query["measurements"];
      return isRecord(measurements) ? measurements["affinity"] : undefined;
    },
  },
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractResultsArray(payload: unknown): unknown[] | undefined {
  if (!isRecord(payload)) return undefined;
  const results = payload["results"];
  if (Array.isArray(results)) return results as unknown[];
  if (isRecord(results) && Array.isArray(results["entities"])) return results["entities"] as unknown[];
  return undefined;
}

export function extractTagsArray(payload: unknown): unknown[] | undefined {
  if (!isRecord(payload)) return undefined;
  const results = payload["results"];
  if (Array.isArray(results)) return results as unknown[];
  if (isRecord(results) && Array.isArray(results["tags"])) return results["tags"] as unknown[];
  if (Array.isArray(payload["tags"])) return payload["tags"] as unknown[];
  return undefined;
}

export function mapEntityList(values: unknown[]): QlooEntity[] {
  const entities: QlooEntity[] = [];
  for (const value of values) {
    const entity = mapEntity(value);
    if (entity !== undefined) entities.push(entity);
  }
  return entities;
}

export function mapEntity(raw: unknown): QlooEntity | undefined {
  if (!isRecord(raw)) return undefined;
  const entityId = raw["entity_id"];
  const name = raw["name"];
  if (typeof entityId !== "string" || entityId.length === 0) return undefined;
  if (typeof name !== "string") return undefined;

  const tagIds: string[] = [];
  const tagNames: string[] = [];
  if (Array.isArray(raw["tags"])) {
    for (const tag of raw["tags"] as unknown[]) {
      if (!isRecord(tag)) continue;
      const id = typeof tag["id"] === "string" ? tag["id"] : tag["tag_id"];
      const tagName = tag["name"];
      if (typeof id === "string") tagIds.push(id);
      if (typeof tagName === "string") tagNames.push(tagName);
    }
  }

  const subtype = raw["subtype"];
  const types = raw["types"];
  const typeFallback = Array.isArray(types) ? types[0] : undefined;
  const entity: QlooEntity = {
    entityId,
    name,
    subtype:
      typeof subtype === "string" ? subtype : typeof typeFallback === "string" ? typeFallback : "",
    tagIds,
    tagNames,
    raw,
  };
  const disambiguation = raw["disambiguation"];
  if (typeof disambiguation === "string") entity.disambiguation = disambiguation;
  const popularity = raw["popularity"];
  if (typeof popularity === "number") entity.popularity = popularity;
  const properties = raw["properties"];
  if (isRecord(properties)) entity.properties = properties;
  return entity;
}

export function mapTagList(values: unknown[]): TagSearchResult["tags"] {
  const tags: TagSearchResult["tags"] = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const id = value["id"];
    const name = value["name"];
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof name !== "string") continue;
    const tag: TagSearchResult["tags"][number] = { id, name };
    const subtype = value["subtype"];
    if (typeof subtype === "string") tag.subtype = subtype;
    tags.push(tag);
  }
  return tags;
}

export function mapScoredEntity(raw: unknown, rankIndex: number): ScoredEntity | undefined {
  const entity = mapEntity(raw);
  if (entity === undefined || !isRecord(raw)) return undefined;

  const scored: ScoredEntity = { entity, rankIndex };
  const affinity = extractAffinity(raw);
  if (affinity !== undefined) {
    scored.affinity = affinity.value;
    scored.affinityFoundAt = affinity.path;
  }

  const query = raw["query"];
  if (isRecord(query)) {
    const explainability = query["explainability"];
    if (explainability !== undefined && explainability !== null) {
      scored.explainabilityRaw = explainability;
      const contributions = extractContributions(explainability);
      if (contributions !== undefined) scored.contributions = contributions;
    }
  }
  return scored;
}

export function extractAffinity(raw: Record<string, unknown>): { value: number; path: string } | undefined {
  const query = raw["query"];
  if (!isRecord(query)) return undefined;
  for (const candidate of AFFINITY_PATHS) {
    const value = candidate.read(query);
    if (typeof value === "number") return { value, path: candidate.path };
  }
  return undefined;
}

export function extractContributions(explainability: unknown): ScoreContribution[] | undefined {
  let source: unknown[] | undefined;
  if (Array.isArray(explainability)) {
    source = explainability as unknown[];
  } else if (isRecord(explainability)) {
    for (const key of ["contributions", "entities", "signal.interests.entities"]) {
      const value = explainability[key];
      if (Array.isArray(value)) {
        source = value as unknown[];
        break;
      }
    }
  }
  if (source === undefined) return undefined;

  const contributions: ScoreContribution[] = [];
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const entityId = entry["entity_id"];
    const score = entry["score"];
    if (typeof entityId !== "string" || entityId.length === 0) continue;
    if (typeof score !== "number") continue;
    contributions.push({ entityId, score });
  }
  return contributions;
}
