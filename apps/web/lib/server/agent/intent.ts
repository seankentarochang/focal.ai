/**
 * Deterministic agent intent parser — pure, offline, no LLM.
 *
 * parseIntent(message) evaluates rules in this fixed order:
 *
 * 1. POLICY — the message contains an explicit boost/hide verb followed by a
 *    phrase (case-insensitive):
 *      boost verbs: boost | more like | favor | prioritise | prioritize
 *        -> { op: "boost-tag", query }
 *      hide verbs:  hide | remove | exclude | block | no | without
 *        -> { op: "exclude-tag", query }
 *    - "sponsor" flips the directive to `collapse-sponsored`: a boost whose
 *      PHRASE contains "sponsor", or a hide verb in a message that contains
 *      "sponsor" anywhere.
 *    - Phrases are trimmed of trailing connectors ("and"/"&") and trailing
 *      punctuation and capped at 40 characters.
 *    - The bare phrase "chains" becomes the tag query "chain" — the tag search
 *      decides whether the tag exists.
 *    - Every verb occurrence yields one directive, so "hide sponsored and
 *      boost natural wine" compiles two; exact duplicates are removed.
 *    - Policy requires at least one non-empty directive; messages with a stray
 *      verb and no phrase fall through to the rules below.
 * 2. DISCOVERY — /(find|discover|suggest|recommend|where|what should|ideas)/
 * 3. EXPLAIN — /(why|explain|reason)/
 * 4. RANK — default.
 * Discovery beats explain when both appear.
 *
 * An LLM-backed intent parser would slot in behind this same signature: parse
 * the message into AgentIntent (e.g. with a tool-call schema), keep the
 * rules-based version as the offline fallback and test oracle.
 */

export type PolicyDirective =
  | { op: "collapse-sponsored" }
  | { op: "boost-tag"; query: string }
  | { op: "exclude-tag"; query: string };

export type AgentIntent =
  | { kind: "policy"; directives: PolicyDirective[] }
  | { kind: "discovery" }
  | { kind: "explain" }
  | { kind: "rank" };

const MAX_QUERY_CHARS = 40;

const BOOST_VERBS = new Set(["boost", "more like", "favor", "prioritize", "prioritise"]);
const SPONSOR_RE = /sponsor/i;
const DISCOVERY_RE = /(find|discover|suggest|recommend|where|what should|ideas)/i;
const EXPLAIN_RE = /(why|explain|reason)/i;

/**
 * Phrase cleanup: drop trailing connectors and punctuation, cap at 40 chars,
 * and keep "chains" as the tag query "chain". Deterministic and idempotent.
 */
function cleanQuery(raw: string): string {
  let phrase = raw.trim();
  for (;;) {
    const before = phrase;
    phrase = phrase.replace(/[.,!?;:'"()[\]{}]+$/u, "").trimEnd();
    phrase = phrase.replace(/(?:\s+\band\b|\s*&)\s*$/iu, "").trimEnd();
    if (phrase === before) break;
  }
  const capped = phrase.slice(0, MAX_QUERY_CHARS).trimEnd();
  if (/^chains$/i.test(capped)) return "chain";
  return capped;
}

function parsePolicyDirectives(message: string): PolicyDirective[] {
  const verbRe = /\b(boost|more like|favor|prioriti[sz]e|hide|remove|exclude|block|no|without)\b/gi;
  const matches = [...message.matchAll(verbRe)];
  const directives: PolicyDirective[] = [];
  const seen = new Set<string>();

  const push = (directive: PolicyDirective) => {
    const key =
      directive.op === "collapse-sponsored"
        ? directive.op
        : `${directive.op}:${directive.query}`;
    if (seen.has(key)) return;
    seen.add(key);
    directives.push(directive);
  };

  matches.forEach((match, index) => {
    const verb = (match[1] ?? "").toLowerCase();
    const isBoost = BOOST_VERBS.has(verb);
    const phraseStart = (match.index ?? 0) + match[0].length;
    const next = matches[index + 1];
    const phraseEnd = next?.index ?? message.length;
    const rawPhrase = message.slice(phraseStart, phraseEnd);

    const sponsorInPhrase = SPONSOR_RE.test(rawPhrase);
    const sponsorInMessage = SPONSOR_RE.test(message);
    if ((isBoost && sponsorInPhrase) || (!isBoost && sponsorInMessage)) {
      push({ op: "collapse-sponsored" });
      return;
    }

    const query = cleanQuery(rawPhrase);
    if (query.length === 0) return;
    push(isBoost ? { op: "boost-tag", query } : { op: "exclude-tag", query });
  });

  return directives;
}

export function parseIntent(message: string): AgentIntent {
  const directives = parsePolicyDirectives(message);
  if (directives.length > 0) return { kind: "policy", directives };
  if (DISCOVERY_RE.test(message)) return { kind: "discovery" };
  if (EXPLAIN_RE.test(message)) return { kind: "explain" };
  return { kind: "rank" };
}
