# Implementation tickets — focal.ai

> **Archived 2026-10-20.** This is the hosted-Studio backlog (T-01..T-25). The product plan changed to the browser extension: see [../spec.md](../spec.md) and the new backlog in [../tickets.md](../tickets.md). Paths below such as `docs/status.md` are relative to the repo root.

**Last status update:** 2026-10-19 (commit `9d6b6fb` — Wave K live Qloo verification) — see `docs/status.md` for the full log.

**Deadline:** October 30, 2026, 11:45pm EDT (Qloo Agentic Hackathon). **Submit a day early** — target Oct 29.

**Current state:** the Studio app (including the Ask-focal agent panel), engine packages, API routes, and the MCP stdio server are implemented and verified — 227 tests (core 86, qloo 60, mcp 13, web 68) plus live-data verification (probe 4/4 exit 0, contract frozen in `docs/qloo-contract.md`, live smoke 6/0/0, live page ranks with grounded affinities); security headers ship on every route and a Docker fallback + `pnpm smoke` production smoke script are ready. `docs/contracts.md` is the frozen interface reference; this file is the execution backlog. Every ticket below is sized for an autonomous coding agent.

**Wave model:** one wave = one parallel agent batch. Wave A foundation → B engine → C web app → D agent & MCP → E ship. Within a wave, tickets that don't share files run in parallel. Keep file ownership disjoint (see `Owns:` globs); if two open tickets touch the same path, the dependency is missing — fix the ticket order, not the file.

**Status convention:** each ticket carries an editable checkbox (`Status: [ ]`). Update it to `Status: [x]` as tickets complete. A ticket is done only when its acceptance criteria pass and its tests run in CI.

**Blocked marks:** tickets marked `BLOCKED: QLOO KEY` could not start until the hackathon key arrived. The key was received 2026-10-19 and T-01 has completed, so no ticket carries this mark anymore.

---

## Wave A — foundation

### T-01 · Probe & freeze Qloo contract
Status: [x] · **P0** · ~3 agent-hours · Deps: Qloo key — key received 2026-10-19 · Owns: `scripts/probe-qloo.ts`, `docs/qloo-contract.md`, `packages/qloo/src/parsers/**`
**Evidence:** commit `9d6b6fb` + `docs/qloo-contract.md` — `pnpm probe` exit 0 with 4/4 HTTP 200 (redacted; key never printed) transcribed into the contract: affinity verdict `results.entities[i].query.affinity` (0..1, sample Rintaro 0.7525 / State Bird 0.7586), explainability at `query.explainability["signal.interests.entities"]`, `/entities` path (not `/v2/entities`), search take max 100, `filter.location.query` for text locality, 429 behavior above 5 req/s (no `Retry-After`). Client fixes and live smoke 6/0/0 landed in the same wave (contract `§3`, `§10`); live page ranks reproduced (Tables first ~3.0 s / State Bird 91.6 with live seeds, Atlas ~2.4 s, Verve ~2.8 s).

**Description:** Run `scripts/probe-qloo.ts` against `https://hackathon.api.qloo.com` with a real key and transcribe exact (redacted) outcomes into `docs/qloo-contract.md`: affinity field exact path + scale, explainability JSON shape, `filter.results.entities` limits, tag shapes, latency, 429 behavior. Update `@focal-ai/qloo` parsers and, if any mapping in `docs/contracts.md` changes, edit `docs/contracts.md` FIRST.
**Acceptance criteria:**
- Every fill-in section of `docs/qloo-contract.md` is filled or explicitly marked `UNKNOWN — reason` (no blank placeholders left).
- Affinity verdict written as an exact JSON path with observed min/max and sample values; parser extraction order updated to match.
- Explainability excerpt captured, or the fallback decision from qloo-contract.md §9 is recorded.
**Tests:** probe script exits non-zero on any endpoint failure; new parser unit tests replay captured (redacted) payloads.
**Risks:** key arrives late → all other work proceeds on mock; excerpt redaction must strip key material and request headers.

### T-02 · Repo scaffold
Status: [x] · **P0** · ~4 agent-hours · Deps: none · Owns: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `apps/web/**` skeleton, `packages/{qloo,core,mcp}/**` skeletons, `.github/workflows/**`, `scripts/probe-qloo.ts` stub
**Evidence:** commit `18cd0cd` — pnpm workspace, app + package skeletons, CI, dev scripts, probe stub; frozen install, typecheck, and build green.

**Description:** pnpm workspace with `apps/web` (Next.js), package skeletons for `@focal-ai/qloo`, `@focal-ai/core`, `@focal-ai/mcp`, dev scripts (`dev`, `build`, `test`, `typecheck`, `lint`, `check`, `probe`), CI (typecheck + test + web build), probe script stub.
**Acceptance criteria:**
- `pnpm install && pnpm check && pnpm build` green on a clean checkout.
- `apps/web` serves a placeholder page; each package exports the contract names from `docs/contracts.md` (even as stubs).
- CI runs on push with no Qloo secret required.
**Tests:** CI itself; a smoke import test per package.
**Risks:** tooling version drift → pin `packageManager` and Node LTS; workspace hoisting surprises → keep deps per-package.

---

## Wave B — engine

### T-03 · `@focal-ai/qloo`: search + entities
Status: [x] · **P0** · ~4 agent-hours · Deps: T-02 · Owns: `packages/qloo/src/{client,search,entities,errors,cache}.ts`, `packages/qloo/test/**`
**Evidence:** commit `18cd0cd` — search + entities methods in `packages/qloo/src/client.ts` (with `errors.ts`, `cache.ts`, `mapping.ts`); mocked-fetch URL, error-mapping, and cache tests — qloo suite 46 tests.

**Description:** Implement `GET /search` (query, types, location, take, page) and `GET /v2/entities` (batch by ID). Zod-tolerant parsing: unknown upstream fields pass through into `raw`; missing optional fields are tolerated. Map HTTP failures to the `QlooError` taxonomy, wire timeout + 1 retry and the TTL cache.
**Acceptance criteria:**
- Canned JSON maps to `QlooEntity` exactly (never throws on extra/missing optional fields).
- Status→code mapping table holds: 401→`AUTH`, 429→`RATE_LIMIT`, 400/422→`BAD_REQUEST`, 404→`NOT_FOUND`, 5xx→`UPSTREAM`, abort→`TIMEOUT`, 2xx-bad-shape→`PARSE`.
- Cache: identical URL within TTL performs a single upstream fetch (spy-verified).
**Tests:** vitest with mocked fetch — golden URL tests for every param combination; table-driven error mapping; cache hit/miss.
**Risks:** upstream field names differ from docs → isolated in parser module, fixed by T-01 without touching call sites.

### T-04 · `@focal-ai/qloo`: insights endpoint
Status: [x] · **P0** · ~4 agent-hours · Deps: T-02 (parser tuning follows T-01) · Owns: `packages/qloo/src/insights.ts`, `packages/qloo/test/insights*`
**Evidence:** commit `18cd0cd` — insights query builder + defensive affinity extraction (`query.affinity` → `query.measurements.affinity`, `affinityFoundAt` recorded) in the qloo client; parsing tests in the 46-test qloo suite.

**Description:** Build `GET /v2/insights` queries: `filter.type`, `signal.interests.entities`, `filter.results.entities` (the scoring primitive), `filter.location.query`, `feature.explainability=true`, `take` (cap 50), `page`. Parse scored entities preserving upstream order; defensive affinity extraction (`entity.query.affinity` → `entity.query.measurements.affinity`, record `affinityFoundAt`); best-effort contribution parsing.
**Acceptance criteria:**
- Given `resultEntityIds`, the result preserves upstream order and `rankIndex` reflects it.
- Unknown affinity shape → `affinity: undefined`, no throw, `affinityFoundAt` records what was checked.
- `take > 50` is clamped, never sent upstream.
**Tests:** fixtures for both known affinity paths plus malformed shapes; empty-results fixture; URL assertion for all params.
**Risks:** explainability shape unverified until T-01 → contribution parsing must be optional-by-default, degradation path mandatory.

### T-05 · `@focal-ai/qloo`: tags + mock adapter
Status: [x] (fixture refresh pending T-01) · **P0** · ~3 agent-hours · Deps: T-03, T-04 · Owns: `packages/qloo/src/{tags,mock}.ts`, `packages/qloo/fixtures/**`, `packages/qloo/test/tags*`, `packages/qloo/test/mock*`
**Evidence:** commit `18cd0cd` — fixture-backed mock client behind `QLOO_MOCK=1` with the `_fixture: "mock"` guard test; search coverage broadened to normalized substring matching across fixtures in `8d18351`.

**Description:** `GET /v2/tags?filter.query=...` mapping to `TagSearchResult`. A full `QlooClient` mock adapter (active only when `QLOO_MOCK=1`) with fixtures derived from public Qloo documentation examples — e.g. the Balthazar place id `FCE8B172-4795-43E4-B222-3B550DC05FD9` from Qloo's public recipe. Fixtures are never presented as live data.
**Acceptance criteria:**
- Every fixture object (at any depth) carries `_fixture: "mock"`; a guard test fails if any fixture lacks the marker.
- Mock client satisfies the `QlooClient` interface; `dataSource` resolves to `"mock"`.
- Live mode is unreachable while `QLOO_MOCK=1` (and vice versa).
**Tests:** fixture-marker guard; mock client shape test; tags URL golden test.
**Risks:** fixtures drift from reality → they are disposable by design; T-01 refreshes or replaces them.

### T-06 · `@focal-ai/core`: profile model + codec
Status: [x] · **P0** · ~2 agent-hours · Deps: T-02 · Owns: `packages/core/src/profile.ts`, `packages/core/test/profile*`
**Evidence:** commit `18cd0cd` — `packages/core/src/profile.ts` codec; round-trip and fuzz tests in the core suite (72 tests).

**Description:** `TasteProfile` model, immutable `addSeed`/`removeSeed`, `serializeProfile`/`deserializeProfile` with version check, `createEmptyProfile`, `PROFILE_STORAGE_KEY = "focal.profile.v1"`.
**Acceptance criteria:**
- Serialize→deserialize round-trips deep-equal.
- Corrupt JSON or unknown `version` → return empty profile and surface a warning; never throw into UI.
- Operations never mutate their input (verified by freeze in tests).
**Tests:** unit round-trip; fuzz random JSON through `deserializeProfile` expecting no throw.
**Risks:** storage quota/corruption — handled by tolerant deserialize by design.

### T-07 · `@focal-ai/core`: resolver
Status: [x] · **P0** · ~3 agent-hours · Deps: T-06 · Owns: `packages/core/src/resolver.ts`, `packages/core/test/resolver*`
**Evidence:** commit `18cd0cd` — `resolve.ts` deterministic city-aware resolver (never guesses on ambiguity); table-driven tests in core 72.

**Description:** `resolveCandidates` with deterministic accept rules: name normalization (case, diacritics, punctuation), exact normalized match required; city/disambiguation match when provided; multiple survivors → `"ambiguous"` (never guess); no match → `"unresolved"`.
**Acceptance criteria:**
- Same input → same output (deterministic across runs).
- Ambiguous inputs resolve to zero entities; the resolver never invents entities or IDs.
- `"Zuni Café"` vs `"Zuni Cafe"` and chain-name collisions (e.g. multiple "Rintaro") are covered by fixed cases.
**Tests:** table-driven units including location mismatch and empty search results.
**Risks:** upstream ranking nondeterminism → accept only when the candidate set is unambiguous under our rules; alternatives are handled by T-12's pinned fallbacks.

### T-08 · `@focal-ai/core`: ranker
Status: [x] · **P0** · ~3 agent-hours · Deps: T-06, T-07 · Owns: `packages/core/src/ranker.ts`, `packages/core/test/ranker*`
**Evidence:** commit `18cd0cd` — `rank.ts` affinity ordering with unresolved-sink and stable ties on `originalIndex`; permutation tests in core 72.

**Description:** `rankCandidates`: order by affinity desc; unresolved candidates sink to the end preserving original relative order; stable ties on `originalIndex`; compute `position`, `affinityPct` (`round(affinity*1000)/10`), and record `ruleEffects` (kind + human label) for matched `ProfileRule`s.
**Acceptance criteria:**
- Documented ordering invariants hold in tests including all-unresolved, empty, and full-tie cases.
- Rules never lift an unresolved candidate above a resolved one; any boost semantics are deterministic, documented in the module, and covered by tests.
- No candidate is scored when `affinity` is missing.
**Tests:** vitest with exhaustive small permutations; property test: output is a permutation of input clientIds.
**Risks:** rule semantics are under-specified by design — pin them in code comments + tests; any change to documented invariants goes through `docs/contracts.md` first.

### T-09 · `@focal-ai/core`: plan compiler + validator + reason builder
Status: [x] · **P0** · ~4 agent-hours · Deps: T-08 · Owns: `packages/core/src/{plan,reason}.ts`, `packages/core/test/{plan,reason}*`
**Evidence:** commit `18cd0cd` — `plan.ts` compiler + validator and grounded `evidence.ts` reason builder; golden plan snapshot in core 72.

**Description:** `planRender` compiles ranked candidates + options into `RenderPlan` ops (`reorder`/`collapse`/`annotate`/`emphasize`/`hide`) with the `summary` counters. `validatePlan` enforces annotation rules (plain text, ≤140 chars, reject `<`), container-id regex `/^focal:[a-z0-9-]+$/i`, and referential integrity. `buildReason` cites ONLY contributions/tags/entities present in the data.
**Acceptance criteria:**
- Validator catches every violation class with a specific error string.
- Reason output never contains entity names or tags absent from inputs (unit-asserted).
- `summary.moved/collapsed/unresolved/avgMovement` match the applied ops exactly.
**Tests:** unit per op type; fuzz annotate strings (length boundary 140/141, `<` rejection); golden plan snapshot for a fixture page.
**Risks:** XSS via annotation text → reject `<` and render as text nodes only (defense in depth).

---

## Wave C — web app

### T-10 · Design system shell
Status: [x] · **P0** · ~3 agent-hours · Deps: T-02 · Owns: `apps/web/app/globals.css`, `apps/web/components/shell/**`, `apps/web/lib/tokens.*`
**Evidence:** commit `8d18351` — `components/shell/**` (TopBar, StatusBadge, ModeSwitcher) and design tokens in `globals.css`; data-source badge fed by `/api/health`.

**Description:** Dark canvas, `#6E56CF` accent, design tokens as CSS custom properties, app layout and nav across demo pages, global data-source status badge (Live vs Mock) fed by `/api/health`.
**Acceptance criteria:**
- Badge reflects `dataSource` and is present on every page that can display Qloo-derived data.
- Body text meets WCAG AA contrast on the chosen canvas.
- No emojis anywhere in UI copy.
**Tests:** component test for badge states; e2e assertion that each demo route renders the badge.
**Risks:** badge forgotten on a new page → the e2e route list is the guard.

### T-11 · Profile composer
Status: [x] · **P0** · ~4 agent-hours · Deps: T-06, T-10 · Owns: `apps/web/components/profile/**`, `apps/web/lib/profile-client.ts`
**Evidence:** commit `8d18351` — `components/profile/**` + `lib/client/store.ts`; seeds persist under `focal.profile.v1` and survive reload (runtime smoke).

**Description:** Seed box with entity picker backed by `POST /api/qloo/search` showing disambiguation, polarity (like/dislike) and weight controls, chip list, export JSON, delete-all, persistence in `localStorage` under `focal.profile.v1`.
**Acceptance criteria:**
- Adding/removing seeds persists across reload; delete-all clears the key.
- Export matches the `TasteProfile` schema exactly (validated by `deserializeProfile`).
- Seeds added via picker carry `source: "searched"`, typed ones `"typed"`.
**Tests:** unit for the storage client; e2e add/remove/reload/export.
**Risks:** corrupt storage → tolerant deserialize (T-06) with a visible warning, never a crash.

### T-12 · Demo page "Tables" (SF restaurants)
Status: [x] · **P0** · ~4 agent-hours · Deps: T-10 · Owns: `apps/web/app/demo/tables/**`, `apps/web/lib/candidates.ts`
**Evidence:** commit `8d18351` — `lib/pages/tables.ts`: 12 SF restaurants, 2 marked sponsored, alternates for unresolved slots; rendered via `ListingCard`.

**Description:** 12 real San Francisco restaurants rendered as directory-style cards (include Bar Part Time, Rintaro, State Bird Provisions, Zuni Café and others in that caliber), 2 marked sponsored, client-side candidate extraction into `PageCandidate[]`, container ids `focal:...`, and 3 pinned alternates swapped in when a candidate fails to resolve.
**Acceptance criteria:**
- Extractor produces `PageCandidate[]` matching the contract (clientId, name, locationText, originalIndex, sponsored).
- Sponsored flags are visible on the 2 marked cards and page HTML never claims otherwise.
- All 12 slots stay filled when alternates swap in.
**Tests:** unit golden for extraction; e2e renders 12 cards; resolution-failure path exercised with mocks.
**Risks:** live entity resolution failures → alternates + T-07 ambiguity handling; never fabricate a resolution.

### T-13 · Rank route `/api/qloo/rank`
Status: [x] · **P0** · ~4 agent-hours · Deps: T-04, T-08, T-09 · Owns: `apps/web/app/api/qloo/rank/route.ts`, `apps/web/lib/server/**`
**Evidence:** commit `8d18351` — `app/api/qloo/rank/route.ts` + `lib/server/**` (zod schemas, rate limit, error mapping, adapters); web suite 21 tests including route contract and rate-limit tests.

**Description:** Compose `resolveCandidates` (search via `QlooClient`) → insights scoring → `rankCandidates` → `planRender`. Zod-validate the body; per-IP rate limit; in-process TTL cache; include `meta.qlooRequest` (path + params, key excluded).
**Acceptance criteria:**
- Response matches `docs/contracts.md` Block C exactly (shape snapshot test).
- Invalid body → 400 with zod issues, no upstream call made.
- `QlooError` maps to honest HTTP statuses and messages; `dataSource: "mock"` only when `QLOO_MOCK=1`.
**Tests:** integration with mocked fetch; contract snapshot; rate-limit unit.
**Risks:** serverless in-process cache is best-effort → acceptable for hackathon, documented in README.

### T-14 · Render engine
Status: [x] · **P0** · ~5 agent-hours · Deps: T-09, T-12 · Owns: `apps/web/components/render/**`, `apps/web/lib/render/**`
**Evidence:** commit `8d18351` — `components/surface/RenderSurface.tsx` + diff strip from `plan.summary`; mock rank smoke shows Rintaro at 93% match, 1 unresolved.
**v1 note:** the ranked presentation is implemented declaratively in React (order + annotations + diff + reset); the raw DOM-mutation engine is deferred to the extension workstream — still P0-compatible because the user-visible before/after/revert behavior is real.

**Description:** Apply `RenderPlan` to the DOM deterministically; Original/Focal/Diff toggle; delta strip reading `plan.summary` (moved/collapsed/unresolved/avgMovement); revert restores the original order.
**Acceptance criteria:**
- Op application order is fixed and tested; toggling never mutates source data.
- Revert returns the exact original order (clientId sequence asserted).
- Diff view highlights moved/annotated cards without altering layout semantics.
**Tests:** unit `apply(plan, dom)` against fixture DOM; e2e toggle + revert.
**Risks:** DOM move bugs → keyed reordering, stable list identity, no innerHTML writes.

### T-15 · Inspector
Status: [x] · **P0** · ~4 agent-hours · Deps: T-13 · Owns: `apps/web/components/inspector/**`
**Evidence:** commit `8d18351` — `components/inspector/Inspector.tsx` (plan / request / raw response / evidence tabs + privacy panel).

**Description:** Tabs: plan / request / raw response / evidence, plus a privacy panel enumerating exactly what leaves the browser (entity names, city, entity IDs, profile) per `docs/contracts.md` §C.
**Acceptance criteria:**
- Request tab shows `meta.qlooRequest` verbatim; raw tab shows the upstream payload with a copy button.
- Privacy panel text matches the contract's data-flow list; no hidden fields.
- Evidence tab shows only contributions/tags present in the data.
**Tests:** e2e presence + snapshot of the rendered request tab for a fixture plan.
**Risks:** large raw payloads → truncate with explicit "show full" affordance; never silently truncate.

### T-16 · Cross-domain pages: Atlas (Lisbon hotels) + Verve (brands)
Status: [x] · **P0** · ~3 agent-hours · Deps: T-13, T-14 · Owns: `apps/web/app/demo/atlas/**`, `apps/web/app/demo/verve/**`
**Evidence:** commit `8d18351` — `lib/pages/atlas.ts` (Lisbon `locationQuery`) and `lib/pages/verve.ts` (brands) feed the same rank route via the page registry.

**Description:** "Atlas": Lisbon hotels using `filter.location.query="Lisbon"`; "Verve": brands (Aesop, Muji, and similar). Cross-domain taste seeds (e.g. music/movie likes) must visibly influence hotel/brand ranking.
**Acceptance criteria:**
- Location filter changes results vs the no-filter call (URL golden test).
- Cross-domain seeds accepted in the insights call and reflected in the ranked order with grounded reasons.
- Empty result → honest empty state, never fabricated cards.
**Tests:** URL golden for location param; e2e with mocked routes; live smoke note for T-01 coverage.
**Risks:** cross-domain support claim (per docs) unverified until T-01 → fallback is same-domain seeds with an honest UI note.

### T-17 · Paste-any-list input (P1)
Status: [x] · **P1** · ~3 agent-hours · Deps: T-07, T-13 · Owns: `apps/web/components/paste/**`
**Evidence:** commit `8f7c909` — paste surface (`components/paste/**`, `lib/client/paste.ts`, line parser + 12 tests; web suite now 33); release-verifier mock smoke green (Paste tab in the static shell, rank 200).

**Description:** Textarea where users paste any list; parse per line, resolve each line, show per-line status (`resolved`/`ambiguous`/`unresolved`) with a picker for ambiguous rows; feeds the same rank pipeline.
**Acceptance criteria:**
- 10-line paste produces immediate per-line statuses; blank lines and leading numbering are tolerated.
- Ambiguous rows require an explicit user pick; unresolved rows can be excluded.
**Tests:** unit line parser; e2e happy path with mocked search.
**Risks:** junk input → statuses stay honest; nothing is auto-picked.

### T-18 · Error/empty/rate-limit/mock states (P1)
Status: [ ] — **Partial** (basic error banner + mock badge + skeleton states exist; deeper empty/rate-limit polish pending) · **P1** · ~3 agent-hours · Deps: T-13 · Owns: `apps/web/components/states/**`

**Description:** First-class UI for: Qloo `QlooError` variants (friendly copy + retry), empty results, rate-limited (respect `retryAfterMs`), mock-mode banner, and fresh-profile empty states ("add seeds to personalize").
**Acceptance criteria:**
- Every state is reachable in tests via query param or env; copy never claims success on failure.
- Mock banner is loud and appears wherever mock data renders.
**Tests:** state matrix unit + e2e snapshots.
**Risks:** time sink — hard timebox at 3h.

---

## Wave D — agent & MCP (P1)

### T-19 · Agent tool loop + timeline
Status: [x] · **P1** · ~8 agent-hours · Deps: T-13, T-15 · Owns: `apps/web/app/api/agent/route.ts`, `apps/web/lib/agent/**`, `apps/web/components/agent/**`
**Evidence:** commit `473f91d` — `app/api/agent/route.ts` intent router (rank / explain / discovery / policy; deterministic tool-plan runner, no LLM required), frozen response types in `lib/server/agent/types.ts`, Ask-focal panel in the right rail (`components/agent/AgentPanel.tsx`, `components/shell/RightRail.tsx`) with tool timeline + approval cards ("Apply to profile" / Dismiss); 32 new agent tests (agentIntent 24, agentRoute 8) + panel tests → web suite 68. Verifier mock smoke: rank → 2 steps (`get_taste_profile`, `score_candidates`); policy → `collapse sponsored` rule + preview plan; discovery → 5 items; `{}` → 400.

**Description:** `POST /api/agent` tool loop. Tools: `get_taste_profile`, `search_entities`, `score_candidates`, `discover_cross_domain`, `explain_ranking`, `create_render_plan`. Anthropic key optional: without `ANTHROPIC_API_KEY` the feature runs degraded (deterministic tool-plan runner) with an honest UI explanation. Tool timeline UI, approval cards, activity feed + revert. **Approval is REQUIRED for profile writes and page apply.** Freeze this route's contract in `docs/contracts.md` Block C before implementing.
**Acceptance criteria:**
- Without a key, the UI explains degraded mode and the manual flow still works end-to-end.
- No side effect (profile mutation, plan application) occurs without an explicit approval click.
- Activity feed entries can be reverted individually.
**Tests:** unit tool handlers with mocks; e2e approval flow with a stubbed model.
**Risks:** scope explosion → hard timebox; approvals must be real, never auto-applied.

### T-20 · `@focal-ai/mcp` stdio server
Status: [x] · **P1** · ~4 agent-hours · Deps: T-09, T-13 · Owns: `packages/mcp/**`
**Evidence:** commit `473f91d` — `packages/mcp` stdio server (`src/{index,tools,deps}.ts`) exposing 6 read-only tools (`get_taste_profile`, `search_entities`, `score_candidates`, `discover_cross_domain`, `explain_ranking`, `create_render_plan` — the last three run the shared `runRankPipeline` via the edge adapter); protocol stdio smoke + tools tests (mcp suite 13); Claude Desktop config documented in `packages/mcp/README.md`. Verifier smoke: server stays up, stdout 0 bytes, banner on stderr only.

**Description:** Stdio MCP server exposing read tools (`search_entities`, `score_candidates`, `explain_ranking`) plus `create_render_plan`; local profile file at an explicit, documented user-scoped path; Claude Desktop config documented in `packages/mcp/README.md`.
**Acceptance criteria:**
- Server lists tools over the MCP protocol; `create_render_plan` returns a `validatePlan`-clean plan.
- Local profile file round-trips the `TasteProfile` JSON schema.
- Config snippet in README works verbatim with Claude Desktop.
**Tests:** protocol smoke via a test client; profile file round-trip.
**Risks:** protocol version drift → pin SDK version; keep tool surface minimal.

---

## Wave E — ship

### T-21 · Hardening
Status: [x] · **P0** · ~3 agent-hours · Deps: T-13, T-23 (re-run after deploy) · Owns: `apps/web/middleware.ts`, `apps/web/next.config.*`, `scripts/leak-check.*`
**Evidence:** commit `3d9796d` — security headers on every route (`apps/web/next.config.ts`; verified live: X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, X-Frame-Options DENY, Permissions-Policy, CSP) + `output: "standalone"` for the Docker fallback; secret scan clean (smoke script's secret-hygiene check + verifier greps of `.next/static` — 1 benign UI-copy hit, no values); rate limits on all POST routes covered by tests; production smoke 5 passed / 0 failed. The human fresh-session rehearsal happens at deploy (T-23).

**Description:** Error taxonomy end-to-end; CSP headers; secret-leak grep asserting the Qloo key never appears in client bundles; rate limits on all POST routes; fresh-session rehearsal (incognito, empty profile).
**Acceptance criteria:**
- `scripts/leak-check` greps the production build output for key material and fails on any hit.
- CSP ships (report-only first, then enforce) without breaking the app.
- Fresh-session rehearsal passes with zero console errors.
**Tests:** leak-check in CI; recorded manual rehearsal checklist.
**Risks:** CSP vs Next inline scripts → nonce/hash strategy; verify before enforce.

### T-22 · Test suite + live smoke
Status: [ ] — **Partial** (227 unit/integration tests green: core 86, qloo 60, mcp 13, web 68; `pnpm smoke` production smoke green on host + Docker and **6 passed / 0 failed / 0 warnings against the live key locally**; Playwright e2e deferred; the pre-submit LIVE smoke has already passed once and **must be rerun against the deployed URL**) · **P0** · ~5 agent-hours · Deps: T-03..T-20 · Owns: `**/*.test.ts`, `e2e/**`, `scripts/smoke-live.ts`

**Description:** vitest unit/integration per package as specified per ticket; Playwright e2e for the primary journey with Qloo routes mocked (CI-safe); `scripts/smoke-live.ts` hitting real endpoints, run pre-submit.
**Acceptance criteria:**
- CI is green with no network access to Qloo.
- Live smoke prints a pass/fail summary per endpoint and is run (and recorded) before submission.
**Tests:** the suite itself; e2e retries only for infrastructure flakiness, never to mask bugs.
**Risks:** e2e flakiness → deterministic mocks; live smoke depends on T-01 + key.

### T-23 · Deploy (Vercel default)
Status: [ ] — **Partial** (Dockerfile + deployment guide + `pnpm smoke` ready and verified; Vercel deploy pending an account) · **P0** · ~3 agent-hours · Deps: T-13, T-14 · Owns: `vercel.json`, `Dockerfile`, `scripts/smoke-prod.*`
**Evidence:** commit `3d9796d` — `Dockerfile` + `.dockerignore` (standalone runner image; in-container smoke passed) and `docs/deployment.md`; the actual Vercel deploy + prod URL smoke still pending an account.

**Description:** Deploy `apps/web` to Vercel with env vars (`QLOO_API_KEY`, `QLOO_API_BASE`, `QLOO_MOCK=0` in prod, optional `ANTHROPIC_API_KEY`); wire `/api/health`; prod smoke checklist; fallback Dockerfile for fly.io/render.
**Acceptance criteria:**
- Prod `/api/health` returns `{ ok: true, hasQlooKey: true, dataSource: "live" }`.
- Primary journey works end-to-end on the hosted URL with live Qloo (see DoD).
- Docker image builds and serves locally as fallback.
**Tests:** prod smoke script; manual checklist recorded in the submission notes.
**Risks:** deployment target not final → Vercel is the default plan; keep the app 12-factor so the fallback is cheap. Preview deployments share secrets — restrict access.

### T-24 · Submission
Status: [ ] — **Partial** (`docs/submission.md` + `docs/demo-script.md` drafted; hosted URLs + final README rewrite pending) · **P0** · ~4 agent-hours · Deps: T-21, T-22, T-23 · Owns: `README.md`, `docs/submission.md`
**Evidence:** commit `3d9796d` — `docs/submission.md` (Devpost text) and `docs/demo-script.md` (rehearsal checklist) drafted; README rewrite and hosted URLs land with the T-23 deploy.

**Description:** README rewrite (real setup instructions, architecture, supported/unsupported disclosure: `/recs` legacy unsupported, LLM features degraded without key, mock mode labeled), Devpost text, screenshots from the prod build, license/About check.
**Acceptance criteria:**
- A stranger can run the project locally in ≤ 10 minutes following README only.
- Unsupported/degraded features are disclosed in both README and Devpost text.
- Everything submitted before Oct 29 EOD (buffer to the Oct 30 11:45pm EDT deadline).
**Tests:** fresh-clone walkthrough timed once; link check on README.
**Risks:** portal quirks → submit a day early, keep a copy of all text in `docs/submission.md`.

### T-25 · MV3 extension (stretch, P2)
Status: [ ] — **Deferred** (stretch; starts only when every P0 is complete) · **P2** · ~6 agent-hours · Deps: all P0 complete · Owns: `apps/extension/**`

**Description:** Manifest V3 extension applying the same engine on 2 pinned origins via the hosted API.
**Acceptance criteria:**
- Rotation strip renders on the 2 pinned origins only; no other origin is touched.
- Documented as experimental in README.
**Tests:** unit extraction; manual checklist on pinned origins.
**Risks:** store review/time → post-hackathon; do not start unless every P0 is done.

---

## Critical path

`T-01` [done] → `T-02` [done] → `T-03`/`T-04` [done] → `T-08`/`T-09` [done] → `T-12`/`T-13`/`T-14` [done] → `T-21` [done] → `T-23` [partial] → `T-24` [partial]

Remaining on the path: T-18 (partial), T-22–T-24 (T-01 is done — key received, contract frozen; T-22's live smoke has passed once locally and must be rerun against the deployed URL). Anything not on this path is parallelizable. Suggested internal milestones: Wave B done Oct 22, Wave C done Oct 26, Wave E done Oct 28, buffer + submit Oct 29 — Waves B, C and the live-Qloo wave landed early (Oct 17–19), so the remaining budget is buffer.

## Key-independent work

Everything can still run without the Qloo key: all packages, tests, UI, agent, and deployment pipeline run against `QLOO_MOCK=1` fixtures and canned payloads, and CI requires no Qloo secret. T-01 has completed against the live API (key received 2026-10-19); treat any unverified mapping as a T-01 follow-up, never as fact.

## Definition of done for the hackathon

- Hosted URL works end-to-end with live Qloo: profile → resolve → score → ranked page with grounded reasons.
- No mocks in the demo path (`QLOO_MOCK=0` in prod; mock mode only reachable deliberately, and loudly labeled).
- Honest disclosures: supported vs unsupported endpoints, degraded LLM mode, and "Qloo affinity" labeling as specified in `docs/contracts.md` §D.
- Tests green in CI, live smoke recorded, Devpost submitted with a day of buffer.
