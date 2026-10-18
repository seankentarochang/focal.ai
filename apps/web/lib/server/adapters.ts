import type { CandidateScore, CoreEntity, CoreSearchFn } from "@focal-ai/core";
import type { QlooClient, QlooEntity, QlooEntityType, ScoredEntity } from "@focal-ai/qloo";

export function toCoreEntity(e: QlooEntity): CoreEntity {
  return {
    entityId: e.entityId,
    name: e.name,
    subtype: e.subtype,
    disambiguation: e.disambiguation,
    popularity: e.popularity,
    tagIds: e.tagIds,
    tagNames: e.tagNames,
  };
}

export function toCandidateScores(entities: ScoredEntity[]): CandidateScore[] {
  return entities.map((scored) => ({
    entityId: scored.entity.entityId,
    affinity: scored.affinity,
    rankIndex: scored.rankIndex,
    contributions: scored.contributions,
    tagNames: scored.entity.tagNames,
  }));
}

export function toCoreSearchFn(client: QlooClient, take = 3): CoreSearchFn {
  return async ({ query, types, location }) => {
    const result = await client.search({
      query,
      types: types as QlooEntityType[] | undefined,
      location,
      take,
    });
    return result.entities.map(toCoreEntity);
  };
}
