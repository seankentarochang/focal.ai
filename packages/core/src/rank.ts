/**
 * Candidate ranker.
 *
 * Documented, deterministic semantics (ticket T-08 / docs/contracts.md Block B):
 *
 * - Local ordering score starts from the raw Qloo affinity. Matching `boost`
 *   rules multiply it by `rule.weight ?? 1.5` (applied in rule order; several
 *   matches compose). A `dislike` profile seed for the same entityId forces the
 *   local score to -1. Boosts never invent a score when affinity is missing.
 * - `exclude`/`collapse` rules (and dislike seeds) only record `ruleEffects`;
 *   actually hiding/collapsing happens in plan.ts.
 * - Sort buckets, in order: (0) resolved with a defined local score, desc by
 *   score; (1) resolved without a defined score; (2) ambiguous; (3) unresolved.
 *   Ties break on originalIndex (stable). No randomness, same input -> same
 *   output.
 * - `affinityPct` is always computed from the RAW affinity
 *   (`round(affinity * 1000) / 10`), never from the locally boosted score.
 */
import type {
  CandidateScore,
  ProfileRule,
  RankedCandidate,
  ResolvedCandidate,
  TasteProfile,
} from "./types";

const BOOST_DEFAULT_WEIGHT = 1.5;
const DISLIKE_LABEL = "you marked this as disliked";
const HIDDEN_LABEL = "hidden by your rules";
const BOOST_LABEL = "boosted by your rules";

type RuleEffect = { kind: ProfileRule["kind"]; label: string };

function buildScoreMeta(score: CandidateScore | undefined): RankedCandidate["scoreMeta"] {
  if (!score) return undefined;
  if (score.contributions === undefined && score.tagNames === undefined) return undefined;
  const meta: NonNullable<RankedCandidate["scoreMeta"]> = {};
  if (score.contributions !== undefined) meta.contributions = score.contributions;
  if (score.tagNames !== undefined) meta.tagNames = score.tagNames;
  return meta;
}

export function rankCandidates(args: {
  candidates: ResolvedCandidate[];
  scores: CandidateScore[];
  profile: TasteProfile;
}): RankedCandidate[] {
  const { candidates, scores, profile } = args;

  const scoreById = new Map<string, CandidateScore>();
  for (const score of scores) {
    if (!scoreById.has(score.entityId)) scoreById.set(score.entityId, score);
  }

  const dislikedIds = new Set(
    profile.seeds.filter((seed) => seed.polarity === "dislike").map((seed) => seed.entityId),
  );

  const entries = candidates.map((candidate) => {
    const entity = candidate.entity;
    const score = entity ? scoreById.get(entity.entityId) : undefined;
    const affinity = score?.affinity;
    const scoreMeta = buildScoreMeta(score);

    const candidateTags = entity
      ? new Set([...(entity.tagIds ?? []), ...(entity.tagNames ?? [])])
      : undefined;

    const ruleEffects: RuleEffect[] = [];
    let localScore: number | undefined = affinity;

    for (const rule of profile.rules) {
      if (rule.kind === "boost") {
        if (rule.match.tagId === undefined) continue;
        if (!candidateTags?.has(rule.match.tagId)) continue;
        if (localScore === undefined) continue;
        localScore *= rule.weight ?? BOOST_DEFAULT_WEIGHT;
        ruleEffects.push({ kind: "boost", label: BOOST_LABEL });
        continue;
      }
      const matchesTag =
        rule.match.tagId !== undefined && candidateTags?.has(rule.match.tagId) === true;
      const matchesBrand =
        rule.match.brandId !== undefined &&
        entity !== undefined &&
        entity.entityId === rule.match.brandId;
      const matchesSponsored = rule.match.flag === "sponsored" && candidate.sponsored === true;
      if (matchesTag || matchesBrand || matchesSponsored) {
        ruleEffects.push({ kind: rule.kind, label: HIDDEN_LABEL });
      }
    }

    if (entity && dislikedIds.has(entity.entityId)) {
      localScore = -1;
      ruleEffects.push({ kind: "exclude", label: DISLIKE_LABEL });
    }

    const bucket =
      candidate.status === "resolved"
        ? localScore !== undefined
          ? 0
          : 1
        : candidate.status === "ambiguous"
          ? 2
          : 3;

    return { candidate, affinity, scoreMeta, ruleEffects, localScore, bucket };
  });

  const sorted = [...entries].sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.bucket === 0) {
      const byScore = (b.localScore ?? 0) - (a.localScore ?? 0);
      if (byScore !== 0) return byScore;
    }
    return a.candidate.originalIndex - b.candidate.originalIndex;
  });

  return sorted.map((entry, position) => {
    const ranked: RankedCandidate = { ...entry.candidate, position };
    if (entry.affinity !== undefined) {
      ranked.affinity = entry.affinity;
      ranked.affinityPct = Math.round(entry.affinity * 1000) / 10;
    }
    if (entry.scoreMeta !== undefined) ranked.scoreMeta = entry.scoreMeta;
    if (entry.ruleEffects.length > 0) ranked.ruleEffects = entry.ruleEffects;
    return ranked;
  });
}
