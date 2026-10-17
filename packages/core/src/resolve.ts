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
 * 5. Outcomes:
 *    - no matches                          -> "unresolved" (no entity)
 *    - >= 2 matches with normalized-equal names but different entityIds
 *                                          -> "ambiguous" (first match attached)
 *    - context non-empty and the best match's normalized disambiguation
 *      contains any city token             -> "resolved" (best match attached)
 *      otherwise                           -> "ambiguous" (best match attached)
 *      (this is what stops "Rintaro" from resolving to a same-named business
 *      in the wrong city)
 *    - context empty: normalized equality  -> "resolved"
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

    const context = normalizeName(candidate.locationText ?? defaults?.location ?? "");
    if (context.length > 0) {
      const cityTokens = context.split(" ").filter((token) => token.length >= 3);
      const disambiguationTokens = new Set(
        normalizeName(best.disambiguation ?? "")
          .split(" ")
          .filter(Boolean),
      );
      const cityMatches = cityTokens.some((token) => disambiguationTokens.has(token));
      resolved.push({
        ...candidate,
        status: cityMatches ? "resolved" : "ambiguous",
        entity: best,
      });
      continue;
    }

    const exact = normalizeName(best.name) === query;
    resolved.push({ ...candidate, status: exact ? "resolved" : "ambiguous", entity: best });
  }

  return resolved;
}
