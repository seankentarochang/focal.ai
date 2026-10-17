/**
 * Grounded reason builder.
 *
 * Reads ONLY data present on the ranked candidate: `scoreMeta.contributions`
 * (filtered to score >= 0.1, sorted desc, top 2) mapped through the profile's
 * seeds by entityId. IDs that are not in the profile are skipped — the builder
 * never invents a relationship, a brand, or a score.
 *
 * When nothing maps, the reason carries `text: undefined` (plus the real tag
 * names when present) so the UI can render its own neutral fallback instead of
 * a fabricated explanation.
 */
import type { BuiltReason, RankedCandidate, TasteProfile } from "./types";

const MIN_CONTRIBUTION_SCORE = 0.1;
const MAX_CITED_CONTRIBUTIONS = 2;

export function buildReason(ranked: RankedCandidate, profile: TasteProfile): BuiltReason {
  const tags = ranked.scoreMeta?.tagNames;

  const grounded = (ranked.scoreMeta?.contributions ?? [])
    .filter((contribution) => contribution.score >= MIN_CONTRIBUTION_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CITED_CONTRIBUTIONS);

  const cited: { name: string; score: number }[] = [];
  for (const contribution of grounded) {
    const seed = profile.seeds.find((s) => s.entityId === contribution.entityId);
    if (seed) cited.push({ name: seed.name, score: contribution.score });
  }

  if (cited.length === 0) {
    return { text: undefined, tags };
  }

  const [first, second] = cited;
  const text =
    first !== undefined && second !== undefined
      ? `Matches your taste for ${first.name} and ${second.name}`
      : `Matches your taste for ${first?.name ?? ""}`;

  return { text, contributions: cited, tags };
}
