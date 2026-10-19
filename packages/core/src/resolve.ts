/**
 * Deterministic candidate resolver.
 *
 * Accept rules (frozen — docs/contracts.md Block B + ticket T-07):
 *
 * 1. Name normalization: lowercase -> NFD -> strip combining marks ->
 *    non-alphanumerics to spaces -> collapse whitespace -> trim.
 * 2. For each page candidate, in input order, call the injected search with
 *    `{ query: candidate.name, types: [expectedType], location:
 *    candidate.locationText ?? defaults?.location }`.
 * 3. Keep results whose subtype === expectedType and whose normalized name
 *    matches the normalized query: exact equality, OR result name startswith
 *    query (query length >= 4), OR query startswith result name (result name
 *    length >= 4). Matches are never invented and subtype is never ignored.
 * 4. Context = normalized location text; city tokens are context tokens with
 *    length >= 3. "Best match" = the first result that is normalized-equal to
 *    the query when one exists, otherwise the first match (Qloo relevance
 *    order is preserved).
 * 5. Outcomes (city context gets the final word over duplicate names):
 *    - no matches                          -> "unresolved" (no entity)
 *    - context non-empty: cityMatches are the matches whose normalized
 *      disambiguation contains any city token (>= 3 chars)
 *        exactly one distinct entityId    -> "resolved" (that entity)
 *        more than one distinct entityId  -> "ambiguous" (first cityMatch)
 *        zero cityMatches                 -> "ambiguous" (first matching result)
 *      This is what lets a San Francisco "Rintaro" resolve to the SF entity
 *      even when same-named entities in other cities are also returned, and
 *      what stops a lone same-named business in the wrong city from resolving.
 *    - context empty: exactly one normalized-equal match
 *                                          -> "resolved"
 *      2+ normalized-equal matches with different entityIds
 *                                          -> "ambiguous" (first match attached)
 *      startsWith-only match               -> "ambiguous"
 *
 * Same input -> same output. Search errors propagate to the caller; the
 * resolver never fabricates entities or IDs to mask a failure.
 */
import type { CoreSearchFn, PageCandidate, ResolvedCandidate } from "./types";

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(normalizedQuery: string, normalizedResult: string): boolean {
  if (normalizedResult === normalizedQuery) return true;
  if (normalizedQuery.length >= 4 && normalizedResult.startsWith(normalizedQuery)) return true;
  if (normalizedResult.length >= 4 && normalizedQuery.startsWith(normalizedResult)) return true;
  return false;
}

export async function resolveCandidates(
  candidates: PageCandidate[],
  search: CoreSearchFn,
  expectedType: string,
  defaults?: { location?: string },
): Promise<ResolvedCandidate[]> {
  const resolved: ResolvedCandidate[] = [];

  for (const candidate of candidates) {
    const location = candidate.locationText ?? defaults?.location;
    const results = await search({
      query: candidate.name,
      types: [expectedType],
      location,
    });

    const query = normalizeName(candidate.name);
    const matches = results.filter(
      (entity) =>
        entity.subtype === expectedType && namesMatch(query, normalizeName(entity.name)),
    );

    if (matches.length === 0) {
      resolved.push({ ...candidate, status: "unresolved", entity: undefined });
      continue;
    }

    const context = normalizeName(candidate.locationText ?? defaults?.location ?? "");
    if (context.length > 0) {
      const cityTokens = context.split(" ").filter((token) => token.length >= 3);
      const cityMatches = matches.filter((entity) => {
        const disambiguationTokens = new Set(
          normalizeName(entity.disambiguation ?? "")
            .split(" ")
            .filter(Boolean),
        );
        return cityTokens.some((token) => disambiguationTokens.has(token));
      });
      const cityEntityIds = new Set(cityMatches.map((entity) => entity.entityId));

      if (cityEntityIds.size === 1) {
        resolved.push({ ...candidate, status: "resolved", entity: cityMatches[0] });
        continue;
      }
      if (cityEntityIds.size > 1) {
        resolved.push({ ...candidate, status: "ambiguous", entity: cityMatches[0] });
        continue;
      }
      resolved.push({ ...candidate, status: "ambiguous", entity: matches[0] });
      continue;
    }

    const hasDuplicateNames =
      matches.some((a) =>
        matches.some((b) => b.entityId !== a.entityId && normalizeName(a.name) === normalizeName(b.name)),
      );
    if (hasDuplicateNames) {
      resolved.push({ ...candidate, status: "ambiguous", entity: matches[0] });
      continue;
    }

    const best = matches.find((m) => normalizeName(m.name) === query) ?? matches[0];
    if (best === undefined) {
      resolved.push({ ...candidate, status: "unresolved", entity: undefined });
      continue;
    }

    const exact = normalizeName(best.name) === query;
    resolved.push({ ...candidate, status: exact ? "resolved" : "ambiguous", entity: best });
  }

  return resolved;
}
