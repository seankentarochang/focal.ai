# focal.ai — Architecture (as built)

> Describes the code in this repo at the wave-3 commit (`8d18351`), not the roadmap. Anything not implemented is marked **planned** and pinned to a ticket in [tickets.md](./tickets.md). Frozen interfaces live in [contracts.md](./contracts.md); anything about live Qloo response shapes is **UNVERIFIED** until the T-01 probe ([qloo-contract.md](./qloo-contract.md)) runs with a real key.

## 1. What focal.ai Studio is

focal.ai Studio is a hosted taste-personalization demo: the user builds a Qloo-resolved taste profile (search → seed → stored in the browser), then opens one of three in-repo demo directory pages (`Tables` — SF restaurants, `Atlas` — Lisbon hotels, `Verve` — brands) and clicks **Focus**. Each page's candidates are resolved against Qloo, re-ranked against the profile through one batched `/v2/insights` affinity call, and rendered in the new order with affinity-percent badges, grounded reasons, a diff mode (`moved/collapsed/avgMovement`), an inspector showing the exact upstream request, and a compiled render plan whose op vocabulary is contract-validated (`validatePlan`, test-enforced).

Scope is honest: only the hosted Next.js app is implemented. The browser extension (planned, T-25) and the MCP server (`packages/mcp`) are roadmap items — the README's extension-first narrative describes the intended product, not this build. LLM features do not exist in code yet; every currently shipped flow is deterministic and works with zero LLM keys.

## 2. Monorepo map

```
focal.ai/
├── apps/
│   └── web/                     Next.js 16 Studio: the only shipped HTTP surface (UI + API routes)
├── packages/
│   ├── qloo/                    @focal-ai/qloo — typed Qloo HTTP client, TTL cache, fixture mock adapter
│   ├── core/                    @focal-ai/core — pure taste/render engine; standalone (no qloo import)
│   └── mcp/                     @focal-ai/mcp — MCP stdio server; stub only (logs a notice, exits 0)
├── scripts/
│   └── probe-qloo.ts            T-01 live contract probe; writes scripts/probe-output/ (created on run, gitignored)
├── docs/
│   ├── contracts.md             Frozen interfaces — source of truth for all packages/routes
│   ├── qloo-contract.md         Live probe record; fill-in template until the key arrives
│   ├── tickets.md               Backlog T-01..T-25, wave plan, definition of done
│   └── assets/logo.svg          Logo asset used by the repo README
├── .github/workflows/ci.yml     CI: frozen install → typecheck → test → web build
├── package.json                 pnpm scripts: dev, dev:all, build, test, typecheck, lint, check, probe
├── pnpm-workspace.yaml          Workspace globs apps/* and packages/* (+ allowBuilds settings)
├── tsconfig.base.json           Shared strict TS options (strict, Bundler resolution, noUncheckedIndexedAccess)
└── .env.example                 QLOO_* + ANTHROPIC_API_KEY + FOCAL_MCP_* placeholders (all empty)
```

## 3. Package responsibilities

### @focal-ai/qloo — Qloo HTTP client (`packages/qloo`)

Public surface (`src/index.ts`): `createQlooClient`, `QlooError`, constants `QLOO_DEFAULT_BASE_URL`, `QLOO_DEFAULT_TIMEOUT_MS`, `QLOO_DEFAULT_CACHE_TTL_MS`, plus client types (`QlooClient`, `QlooEntity`, `SearchParams`, `SearchResult`, `InsightsParams`, `InsightsResult`, `ScoredEntity`, `ScoreContribution`, `TagSearchResult`, `QlooEntityType`, `QlooErrorCode`, `DataSource`). `createMockQlooClient` and `QLOO_DEFAULT_INSIGHTS_TAKE` are internal (not re-exported); mock mode is selected inside `createQlooClient` via `opts.mock ?? process.env.QLOO_MOCK === "1"`.

Key behaviors:

- **4 endpoint methods — `QlooClient`**: `search` (`GET /search`), `insights` (`GET /v2/insights`), `searchTags` (`GET /v2/tags`), `getEntities` (`GET /v2/entities`). Auth header `X-Api-Key` (server env only), `accept: application/json`; `take` clamped (search 1..199, insights/tags 1..50); insights `take` defaults to 20.
- **Error taxonomy**: `QlooError` with codes `AUTH` (401/403), `RATE_LIMIT` (429, `retryAfterMs` parsed from `Retry-After`), `BAD_REQUEST` (400/422), `NOT_FOUND` (404), `UPSTREAM` (5xx), `TIMEOUT`, `PARSE` (2xx but bad shape).
- **Timeout/retry**: default `timeoutMs` 8000 via `AbortController`; exactly 1 retry after 300 ms, only for `TIMEOUT`/`UPSTREAM`.
- **TTL cache**: in-process, default 600 000 ms (10 min), keyed by the query-param set (API key excluded from keys).
- **Defensive affinity extraction** (`src/mapping.ts`): tries `query.affinity` first, then `query.measurements.affinity`; on success records the winning path in `affinityFoundAt`; never throws on unknown shapes — the entity is returned with `affinity: undefined`. Unknown upstream fields pass through in `raw` and `explainabilityRaw`.
- **Fixture-backed mock** (`src/mock.ts`, `fixtures/*.json`): every fixture root carries `_fixture: "mock — hand-authored from public docs examples, not live Qloo data"`, and mock `search` echoes the marker in its payload; 50 ms simulated latency. Mock search does name **substring** matching over the fixture payloads only, so candidates whose names are not in a fixture stay `unresolved` in mock mode (they still get ranked; `meta.unresolved` counts them). Mock insights serves the insights fixture filtered by `resultEntityIds` and ignores signal IDs.

Dependencies: `zod` (workspace-internal only).

### @focal-ai/core — pure taste/render engine (`packages/core`)

Standalone and framework-free: imports **nothing** from `@focal-ai/qloo` (verified — mentions are comments only) and its only dependency is `zod`. Other packages depend on core (`apps/web`, `packages/mcp`); core depends on none of them. `apps/web` adapts between core and qloo via the `CoreSearchFn` wrapper (`apps/web/lib/server/adapters.ts`).

Public surface (`src/index.ts` re-exports everything): `PROFILE_STORAGE_KEY`, `createEmptyProfile`, `addSeed`, `removeSeed`, `serializeProfile`, `deserializeProfile`, `normalizeName`, `resolveCandidates`, `rankCandidates`, `planRender`, `validatePlan`, `buildReason`, `VERSION`, plus all Block-B types.

Key behaviors:

- **Profile model/codec** (`profile.ts`): versioned `TasteProfile` (`version: 1`, seeds, rules); all functions pure/immutable; `addSeed` dedupes by `entityId` and keeps the original `addedAt` when re-adding; deterministic serialization (explicit key order); `deserializeProfile` throws specific errors on bad JSON / wrong version / bad shape, and the web layer catches them and falls back. localStorage key: `focal.profile.v1`.
- **Resolver** (`resolve.ts`): deterministic; per candidate calls the injected search (`query = name`, `types = [expectedType]`, `location = locationText ?? defaults.location`), accepts a hit only when `entity.subtype === expectedType` AND names match (normalized: lowercase/NFD/diacritics stripped/punctuation collapsed) with exact-or-prefix rules (min length 4). City-context rule: if a location context exists, the best match is `resolved` only when a city token (length ≥3) appears in the normalized `disambiguation`; otherwise `ambiguous`; duplicate same-name matches → `ambiguous`; no matches → `unresolved`. Never fabricates entities; search errors propagate.
- **Ranker** (`rank.ts`): buckets in order — (0) resolved with a defined local score, desc; (1) resolved without affinity; (2) ambiguous; (3) unresolved. Ties break on `originalIndex` (stable). `boost` rules multiply the *local* score (default weight 1.5) and never invent a score; `exclude`/`collapse` rules and `dislike` seeds only record `ruleEffects` (a dislike seed forces local score −1). `affinityPct = round(affinity*1000)/10` is always computed from the **raw** affinity, never the boosted one.
- **Plan compiler + validator** (`plan.ts`): `planRender` emits a fixed op order — `reorder` (all clientIds), sponsored `collapse`, hidden-by-rules `collapse`, `annotate` (`"<pct>% match"` for resolved+scored), `emphasize` (≥ threshold, default 85) — with `summary {moved, collapsed, unresolved, avgMovement}`; plan `id`/`createdAt` are non-deterministic (UUID/timestamp), the structure is deterministic. `validatePlan` collects every violation: exactly the 5 enum ops (`reorder`, `collapse`, `annotate`, `emphasize`, `hide`), `containerId` must match `/^focal:[a-z0-9-]+$/i`, annotate text plain ≤140 chars with no `"<"`, and referential integrity against the reorder universe. Note: `validatePlan` is exercised by tests, not called at runtime by the rank route.
- **Grounded evidence builder** (`evidence.ts`): `buildReason` cites only `scoreMeta.contributions` with score ≥ 0.1 (top 2, desc) mapped through profile seeds by `entityId`; unmapped IDs are skipped; when nothing maps, `text` is `undefined` (the UI shows its own neutral fallback) — no fabricated relationships ever.

Dependencies: `zod` only.

### @focal-ai/mcp — MCP stdio server (`packages/mcp`)

**Stub.** `src/index.ts` logs `"[focal-ai/mcp] MCP server not implemented yet — see docs/tickets.md (T-20)"` and exits 0. Package declares a `focal-mcp` bin and `dev`/`start` scripts (tsx), and depends on `@focal-ai/core` + `@focal-ai/qloo` for the future implementation. No tests. Roadmap: T-20.

## 4. Web app structure (`apps/web`)

Route map:

| Route | Type | Behavior |
| --- | --- | --- |
| `/` | static prerender | Single-page Studio (`app/page.tsx` is a client component); profile-dependent UI hydrates from localStorage |
| `GET /api/health` | dynamic (`await connection()`) | `{ ok, hasQlooKey, dataSource }` — boolean key presence only, never the key |
| `POST /api/qloo/search` | dynamic | zod body `{query ≤80, types?, location?}`; rate limit 30/min; `client.search` with `take: 8`; returns entities + `{dataSource, durationMs}` meta |
| `POST /api/qloo/rank` | dynamic | zod body `{pageId, pageType, locationQuery?, containerId?, candidates 1..50, profile}`; rate limit 20/min; resolve → insights → rank → plan; `400` when the profile has no `like` seed |

Component/lib map:

| Path | One-line purpose |
| --- | --- |
| `components/shell/TopBar.tsx` | Header: logo, demo-page tabs, status badge, mode switcher, Focus/Reset buttons |
| `components/shell/ModeSwitcher.tsx` | Original / Focal / Diff toggle (disabled until a rank response exists) |
| `components/shell/StatusBadge.tsx` | Health pill: "Qloo key not configured" / "MOCK DATA" / "Qloo connected", plus seed count |
| `components/profile/ProfilePanel.tsx` | Seed chip list, export-JSON download, clear-all (with confirm); copy: "Stored in this browser only" |
| `components/profile/EntityPicker.tsx` | Search box over `POST /api/qloo/search`; adds a `like` seed with `source: "searched"` |
| `components/surface/RenderSurface.tsx` | Page header, status line, diff strip (`plan.summary`), card list sorted by `ranked.position` in Focal/Diff modes (Original mode keeps page order) |
| `components/surface/ListingCard.tsx` | Card: initial avatar, grounded reason line, meta/blurb, "Sponsored" tag, `% match` badge, diff delta arrow |
| `components/inspector/Inspector.tsx` | Qloo request (path + params verbatim), source/duration/unresolved, plan op summary lines, top-3 evidence |
| `lib/server/qloo.ts` | Module-level `createQlooClient()` singleton + `dataSource()` ("mock" only when `QLOO_MOCK === "1"`) |
| `lib/server/adapters.ts` | `QlooEntity → CoreEntity`, `ScoredEntity → CandidateScore`, and the `CoreSearchFn` wrapper that calls Qloo `search` with `take: 3` |
| `lib/server/schemas.ts` | zod schemas for both POST bodies (candidates 1..50, profile rules ≤20) |
| `lib/server/rateLimit.ts` | In-memory fixed-window limiter keyed by first `x-forwarded-for` hop (fallback `"local"`) |
| `lib/server/errors.ts` | `QlooError → HTTP` status map (AUTH→500 "key not configured", RATE_LIMIT→429, …), zod → 400, fallback 500 |
| `lib/client/store.ts` | localStorage profile load/save/clear (`focal.profile.v1`), `useProfile` hook, import/export helpers, SSR-safe constants |
| `lib/client/api.ts` | `fetch` wrappers: `searchEntities`, `rankPage`, `getHealth` |
| `lib/client/types.ts` | `DemoPage`/`DemoCandidate`, `RankResponse`, `SurfaceMode`, health/search response types |
| `lib/pages/{tables,atlas,verve}.ts` + `index.ts` | The three in-repo demo pages (12/10/12 candidates for Tables/Atlas/Verve, `containerId: "focal:results"`, 2 sponsored entries per page) |
| `tests/server/{adapters,rateLimit,routes}.test.ts` | Vitest (node env): adapter mapping, limiter behavior, route contract tests including "no key in response" |

## 5. Rank request — data flow (as built)

```
Browser (Studio UI)                     apps/web server (Next route)              Qloo API
────────────────────                    ─────────────────────────────            ─────────
click "Focus N results"
POST /api/qloo/rank
{ pageId, pageType, locationQuery,
  containerId, candidates ≤50,
  profile (seeds+rules) }  ──────────►  rate limit: 20 req/min/clientKey
                                        zod rankBodySchema (else 400)
                                        like-seeds = seeds(like).slice(0,20)
                                        zero like-seeds → 400
                                        │
                                        ├─ for each candidate, in input order:
                                        │    GET /search  ──────────────────►  /search
                                        │    query=<name>,
                                        │    types=[pageType],
                                        │    filter.location=<locationText
                                        │      ?? locationQuery>, take=3
                                        │    keep subtype===pageType     ◄────  results.entities[]
                                        │    + name match; city token in
                                        │      disambiguation → resolved
                                        │
                                        ├─ resolvedIds = [] → skip insights,
                                        │    still return ranked + plan
                                        │
                                        └─ ONE call: GET /v2/insights  ─────►  /v2/insights
                                           filter.type=pageType
                                           signal.interests.entities=like-seed ids
                                           filter.results.entities=resolved ids
                                           filter.location.query=city (if any)
                                           feature.explainability=true
                                           take=clamp(20..50, resolvedIds.length)
                                                                          ◄────  scored entities
                                        rankCandidates(affinity buckets)
                                        buildReason (grounded in profile seeds)
                                        planRender(containerId ?? "focal:results")
                                        │
{ ranked, plan,                       ◄──┘
  meta{ dataSource, durationMs,
        unresolved,
        qlooRequest{ path, params } } }  ──►  surface re-orders cards by ranked.position,
                                              renders % match + reasons; diff mode shows
                                              summary/deltas; Inspector shows meta.qlooRequest
```

What leaves the browser: candidate **name strings** + city strings (resolution searches), the profile's **like-seed entity IDs** (as `signal.interests.entities`) and **resolved Qloo IDs** (as `filter.results.entities`) — plus the profile JSON itself, sent to **our** server with each rank request and discarded after the response (no DB, no logs). What never leaves: page HTML/DOM (the "pages" are in-repo structured fixtures, not scraped), form values, and anything not on a demo page. The server never persists the profile; `meta.qlooRequest` excludes the API key (asserted in route tests).

## 6. Invariants (as built)

- **Stateless server**: no database, no accounts, no server-side profile. The only in-process state is the qloo TTL cache and the rate-limit map — both best-effort, per-instance, lost on restart/redeploy.
- **Profile lives in the browser only** (`localStorage` key `focal.profile.v1`); it travels per request and is discarded; the UI offers export JSON and clear.
- **Mock mode only when `QLOO_MOCK=1`**; fixtures are labeled `_fixture`, the mock client echoes the marker, the UI badges mock data (status pill `MOCK DATA` when a key is configured; the Inspector `source` chip always shows the per-response `dataSource`), and mock is never enabled in committed config (`.env.example` leaves `QLOO_MOCK=` empty; real data is required for the judged demo).
- **No fabricated scores or reasons**: unresolved candidates keep their relative positions (bucket 3, stable ties); missing affinity never produces a favorable score or a `% match` badge; `buildReason` cites only contributions present in the response and mapped to profile seeds, otherwise leaves `text` undefined.
- **Ranking uses raw Qloo affinity only** — `popularity` is passed through the adapter (`CoreEntity.popularity`) but is never summed into ranking or the displayed percent; note: the Studio UI does not currently display `popularity` anywhere.
- **API key is server-only**: read from server env in `createQlooClient` (variables documented in `apps/web/.env.example`; local values in a gitignored `.env.local`), sent as `X-Api-Key`, never returned by any route (`/api/health` exposes only a boolean), never in `meta.qlooRequest`.

## 7. Contracts & conventions

- [contracts.md](./contracts.md) is the frozen source of truth for types, defaults, route shapes, and honesty rules; any contract change edits that file first.
- **Subtype convention (pending verification)**: the resolver requires the exact `entity.subtype === expectedType` (packages/core/src/resolve.ts). Demo pages declare `pageType` as `urn:entity:place` (Tables, Atlas) or `urn:entity:brand` (Verve), and mock fixtures use `urn:entity:*` subtypes (e.g. `urn:entity:place`) so the mock path resolves. The **live Qloo subtype value is UNVERIFIED** — it is confirmed only when the hackathon key arrives and `pnpm probe` (scripts/probe-qloo.ts, ticket T-01) is run and its outcomes are transcribed into [qloo-contract.md](./qloo-contract.md). Until then, treat every mapping as a T-01 TODO.
- Probe behavior today: without `QLOO_API_KEY` it prints setup instructions and exits 2; with a key it probes `/search` (place + artist), `/v2/insights`, `/v2/tags`, saves redacted payloads to `scripts/probe-output/` (gitignored), and exits non-zero on any failure.
- **Testing posture**: vitest only — core 72 tests / qloo 46 / web 21 (mcp: none); CI (`.github/workflows/ci.yml`) runs frozen install + typecheck + test + web build on push/PR to `main`. Playwright e2e and live smoke are planned (T-22).

## 8. Deployment shape (planned — not executed)

- **Target**: Vercel serving `apps/web` (Next 16). Server-only env: `QLOO_API_KEY`, `QLOO_API_BASE` (defaults to `https://hackathon.api.qloo.com`), optional `ANTHROPIC_API_KEY`; `QLOO_MOCK=0` in production (T-23). Fallbacks if Vercel is unavailable: Docker on fly.io / render (T-23).
- **MCP**: stdio, local only (T-20); no hosted endpoint.
- **Database**: none, by design — the browser holds the only durable profile state.
- Nothing above is deployed or rehearsed yet: no account/domain, no `vercel.json`/`Dockerfile` in the repo, and the live end-to-end demo depends on the T-01 key arriving. See the "Definition of done" in [tickets.md](./tickets.md).
