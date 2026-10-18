# Devpost submission — focal.ai

## 1. Project name + tagline

**focal.ai** — "The web, rendered for you."

## 2. Elevator pitch

Paste your taste once — the food, music, places, and brands you love. focal.ai resolves those seeds to Qloo entity IDs and re-ranks any list against them: the built-in demo directories or a list you paste yourself. You get a before/after diff, per-item evidence, and one-click revert. The ranking is Qloo's cross-domain affinity — no invented scores, no fabricated reasons. It is taste personalization for lists that no site ever built a recommender for.

## 3. What it does

- **Taste profile with Qloo resolution.** Search-and-disambiguate entities against Qloo's graph, add them as seeds (likes), remove them, export the profile as JSON, clear it. Stored in the browser only.
- **Three demo directories + paste-any-list.** Tables (SF restaurants), Atlas (Lisbon hotels), Verve (brands) — plus a Paste tab that takes up to 50 names, one per line, with an entity type and optional city.
- **Original / Focal / Diff views.** Original is the site order; Focal is the Qloo-ranked order; Diff adds the moved/collapsed/avgMovement strip and per-card delta arrows.
- **Match badges + grounded reasons.** Percent badges are Qloo affinity (`round(affinity*1000)/10`); reason lines cite only contributions present in the response and mapped to your seeds — otherwise no reason text rather than an invented one.
- **Inspector.** The exact upstream Qloo request (path + params, key excluded), source/duration/unresolved counts, the compiled plan ops, and the top-3 evidence.
- **Ask focal (agent panel).** Quick prompts ("Rank this page", "Find me something similar", "Explain the top results", "Hide sponsored"), a visible tool timeline, and approval cards — policy changes are previewed and apply only on "Apply to profile".
- **MCP server.** Local stdio, 6 read-only tools (`get_taste_profile`, `search_entities`, `score_candidates`, `discover_cross_domain`, `explain_ranking`, `create_render_plan`) so external agents can run the same grounded pipeline.
- **Reversible by design.** Original view, Reset, and Clear restore the site order at any time — nothing about your profile or a ranking is locked in.

## 4. How Qloo is used

- `GET /search` — resolves every candidate name to a Qloo entity, with type and location filters and disambiguation awareness. Anything that does not resolve stays unresolved.
- `GET /v2/insights` — **one batched call per page**: `signal.interests.entities` (your liked seed IDs — the taste vector), `filter.results.entities` (the resolved candidate set being ranked), `filter.location.query` (city context), `feature.explainability=true`.
- `GET /v2/tags` — compiles agent policy rules (e.g. "hide sponsored", "boost natural wine") into tag-based rules.
- `GET /v2/entities` — wrapped by the client and available for entity enrichment.

All four endpoints are wrapped by one typed client with an error taxonomy, timeout/retry, and a TTL cache; the key stays server-side and is excluded from anything the UI can see.

The ranking **is** Qloo's cross-domain affinity: the result order and each candidate's affinity come from that one insights call. Affinity is always labeled as Qloo affinity; `popularity` is never blended in; a missing affinity never produces a favorable score or a badge.

## 5. What makes it agentic

Ask focal runs a full agentic loop: intent → tool calls → structured plan → preview → approval → apply, with a visible tool timeline (tool, summary, duration per step). Four intents ship today: rank, explain, discovery, and policy. Policy changes land in your profile's rules only after you press "Apply to profile"; "Dismiss" leaves the profile untouched. The same pipeline is exposed over MCP, so an external agent gets the identical grounded tools.

The design is LLM-optional: the agent is deterministic today and needs no LLM key, and ranking, permissions, and DOM-visible changes are deterministic and validated — every compiled render plan is re-validated before it reaches the surface. The MCP server calls the same shared rank pipeline as the web app, so an external agent's results match the Studio's.

## 6. Why cultural intelligence matters

- **The demo contrast.** Same candidates, two orderings: the site's default order, with two sponsored chain entries placed in the list and flagged "Sponsored", versus the Qloo order (your taste first; the sponsored placements are collapsed by the plan).
- **Cross-domain transfer.** A music seed plus a restaurant seed (Fugazi, Rintaro-class) re-rank a Lisbon hotel list and a brand directory you have never visited, because affinity is computed across Qloo's cultural domains, not within one catalog.
- **Grounded reasons.** Evidence comes from Qloo explainability mapped back to your seeds. A generic LLM can produce plausible-sounding reasons, but it cannot produce cross-domain affinity it does not have — and we refuse to fabricate either.

## 7. Target user + impact

People with strong taste who are tired of pay-to-play rankings: restaurant, hotel, and brand directories where placement is bought. One profile, portable across every list, readable and editable as JSON, cold-started from a handful of seeds. The browser extension that applies the same decisions to live pages is the roadmap; the MCP server already lets external agents drive the same pipeline today.

## 8. Tech stack + repo links

Next.js 16.4.2 / React 19 / TypeScript (strict), pnpm monorepo (`apps/web` + `packages/{qloo,core,mcp}`), zod, Tailwind 4, vitest (209 tests: core 82, qloo 46, mcp 13, web 68), MCP SDK.

- Repo: `<URL — TBD; push to tsangh5/focal.ai pending access>`
- Live demo: `<URL — TBD; not deployed yet>`
- Run it locally with zero keys: `pnpm install && QLOO_MOCK=1 pnpm dev` (mock mode is labeled in the UI). Live mode reads `QLOO_API_KEY` from the server environment.

## 9. Known limitations

- The hosted Studio ranks its built-in demo directories and lists you paste — it is not a browser extension yet and does not touch arbitrary live sites.
- Demo directory copy and metadata are fictionalized (venue names are real; blurbs, prices, and ratings are demo copy).
- Live Qloo verification is pending the hackathon key; until it arrives everything runs on labeled fixture data (the UI badges it as MOCK DATA).
- Reasons appear when Qloo returns explainability for the request; otherwise items rank by affinity with no reason text instead of a fabricated one.
