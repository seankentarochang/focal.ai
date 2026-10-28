# Locked interfaces (source of truth for parallel implementation)

These names and shapes are frozen. Implementation agents must code against them exactly. Any change requires **editing this file first**, then the code — never the reverse. If an implementation cannot satisfy a contract, stop and raise it; do not silently deviate.

Packages: `@focal-ai/qloo` (Qloo HTTP client, no React/Next deps), `@focal-ai/core` (pure taste/render engine), `@focal-ai/web` (`apps/web` — the only adapter between the two packages), `@focal-ai/mcp` (stdio MCP server: read tools + `create_render_plan`).

## A. `@focal-ai/qloo` — Qloo HTTP client

Only this package talks to Qloo. It owns auth, parsing, error taxonomy, timeout/retry, and the TTL cache. `raw` fields carry the unmodified upstream payload so the inspector can show request/response pairs. Nothing in this package interprets taste — that is `@focal-ai/core`'s job.

```ts
export type QlooEntityType =
  | "urn:entity:artist" | "urn:entity:book" | "urn:entity:brand"
  | "urn:entity:destination" | "urn:entity:movie" | "urn:entity:person"
  | "urn:entity:place" | "urn:entity:podcast" | "urn:entity:tv_show" | "urn:entity:videogame";

export interface QlooEntity {
  entityId: string;
  name: string;
  subtype: string;
  disambiguation?: string;
  popularity?: number;
  tagIds: string[];
  tagNames: string[];
  properties?: Record<string, unknown>;
  raw: unknown;
}

export interface SearchParams { query: string; types?: QlooEntityType[]; location?: string; take?: number; page?: number; }
export interface SearchResult { entities: QlooEntity[]; durationMs: number; raw: unknown; }

export interface InsightsParams {
  resultType: QlooEntityType;
  signalEntityIds: string[];
  signalTagIds?: string[];
  resultEntityIds?: string[];
  locationQuery?: string;
  explainability?: boolean;
  take?: number;
}
export interface ScoreContribution { entityId: string; score: number; }
export interface ScoredEntity {
  entity: QlooEntity;
  affinity?: number;
  affinityFoundAt?: string;
  rankIndex: number;
  contributions?: ScoreContribution[];
  explainabilityRaw?: unknown;
}
export interface InsightsResult { entities: ScoredEntity[]; aggregateExplainability?: unknown; durationMs: number; raw: unknown; }
export interface TagSearchResult { tags: { id: string; name: string; subtype?: string }[]; raw: unknown; }
export type DataSource = "live" | "mock";

export interface QlooClient {
  search(params: SearchParams): Promise<SearchResult>;
  insights(params: InsightsParams): Promise<InsightsResult>;
  searchTags(params: { query: string; take?: number }): Promise<TagSearchResult>;
  getEntities(entityIds: string[]): Promise<{ entities: QlooEntity[]; raw: unknown }>;
}

export declare function createQlooClient(opts: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  mock?: boolean;
  timeoutMs?: number;
  cacheTtlMs?: number;
}): QlooClient;

export type QlooErrorCode = "AUTH" | "RATE_LIMIT" | "BAD_REQUEST" | "NOT_FOUND" | "UPSTREAM" | "TIMEOUT" | "PARSE";
export declare class QlooError extends Error {
  code: QlooErrorCode;
  status?: number;
  retryAfterMs?: number;
}
```

Defaults and behavior (all overridable via `createQlooClient` opts):

| Setting | Default | Notes |
| --- | --- | --- |
| `baseUrl` | `process.env.QLOO_API_BASE ?? "https://hackathon.api.qloo.com"` | Auth header `X-Api-Key`; hackathon keys work ONLY against this host. 401 confirmed without key. |
| `mock` | `process.env.QLOO_MOCK === "1"` | Mock fixtures must be loudly labeled (`_fixture: "mock"`), derived from public Qloo doc examples, never presented as live data. |
| `timeoutMs` | `8000` | On timeout: exactly 1 retry, then `QlooError` code `TIMEOUT`. |
| `cacheTtlMs` | `600000` (10 min) | In-process TTL cache keyed by full request URL (key excluded). |

Endpoints used — and only these: `GET /search`, `GET /v2/insights`, `GET /v2/tags?filter.query=...`, `GET /entities`. `/recs` and `/recommendations` are unsupported legacy; never call them.

Insights parameter mapping: `resultType` → `filter.type` (required, e.g. `urn:entity:place` / `brand` / `destination` / `artist` / `movie`); `signalEntityIds` → `signal.interests.entities` (comma-separated taste seed IDs, cross-domain explicitly supported); `signalTagIds` → `signal.interests.tags` (comma-separated tag IDs from vibes, verified 2026-10-20, spec §5.5); `resultEntityIds` → `filter.results.entities` (comma-separated candidate IDs to score/rank — this is the scoring primitive); `locationQuery` → `filter.location.query` (city); `explainability` → `feature.explainability=true`; `take` max 50, default 20; `page` for pagination.

Affinity extraction must be defensive: try `entity.query.affinity`, then `entity.query.measurements.affinity`, and record which path succeeded in `affinityFoundAt`. Unknown shapes must never throw — return the entity with `affinity: undefined`. The exact path/scale is verified in ticket T-01 and recorded in [qloo-contract.md](./qloo-contract.md).

Error taxonomy: `AUTH` (401/403), `RATE_LIMIT` (429, populate `retryAfterMs` from `Retry-After` when present), `BAD_REQUEST` (400/422), `NOT_FOUND` (404), `UPSTREAM` (5xx), `TIMEOUT`, `PARSE` (shape mismatch on a 2xx).

## B. `@focal-ai/core` — pure engine

Standalone and framework-free: it imports **nothing** from `@focal-ai/qloo` (web and MCP adapt between the two). All functions are pure/deterministic except `resolveCandidates`, which takes an injected `CoreSearchFn` — the seam where `apps/web` wraps `QlooClient.search`.

```ts
export interface CoreEntity { entityId: string; name: string; subtype: string; disambiguation?: string; popularity?: number; tagIds?: string[]; tagNames?: string[]; }
export type CoreSearchFn = (args: { query: string; types?: string[]; location?: string }) => Promise<CoreEntity[]>;

export interface TasteSeed { entityId: string; name: string; subtype: string; disambiguation?: string; polarity: "like" | "dislike"; weight: number; source: "typed" | "searched" | "agent"; addedAt: string; }
export interface ProfileRule { kind: "exclude" | "collapse" | "boost"; match: { tagId?: string; brandId?: string; flag?: "sponsored" }; weight?: number; }
export interface TasteProfile { version: 1; updatedAt: string; seeds: TasteSeed[]; rules: ProfileRule[]; }
export declare const PROFILE_STORAGE_KEY = "focal.profile.v1";
export declare function createEmptyProfile(): TasteProfile;
export declare function addSeed(p: TasteProfile, seed: TasteSeed): TasteProfile;
export declare function removeSeed(p: TasteProfile, entityId: string): TasteProfile;
export declare function serializeProfile(p: TasteProfile): string;
export declare function deserializeProfile(json: string): TasteProfile;

export interface PageCandidate { clientId: string; name: string; locationText?: string; url?: string; originalIndex: number; sponsored?: boolean; }
export type ResolutionStatus = "resolved" | "ambiguous" | "unresolved";
export interface ResolvedCandidate extends PageCandidate { status: ResolutionStatus; entity?: CoreEntity; }
export declare function resolveCandidates(candidates: PageCandidate[], search: CoreSearchFn, expectedType: string, defaults?: { location?: string }): Promise<ResolvedCandidate[]>;

export interface CandidateScore { entityId: string; affinity?: number; rankIndex: number; contributions?: { entityId: string; score: number }[]; tagNames?: string[]; }
export interface RankedCandidate extends ResolvedCandidate {
  position: number;
  affinity?: number;
  affinityPct?: number;
  scoreMeta?: { contributions?: { entityId: string; score: number }[]; tagNames?: string[] };
  reason?: { text: string; contributions?: { name: string; score: number }[]; tags?: string[] };
  ruleEffects?: { kind: ProfileRule["kind"]; label: string }[];
}
export declare function rankCandidates(args: { candidates: ResolvedCandidate[]; scores: CandidateScore[]; profile: TasteProfile }): RankedCandidate[];

export type RenderOp =
  | { op: "reorder"; containerId: string; order: string[] }
  | { op: "collapse"; containerId: string; clientIds: string[]; label: string }
  | { op: "annotate"; containerId: string; clientId: string; text: string; badge?: "top-pick" | "good-match" }
  | { op: "emphasize"; containerId: string; clientId: string; level: "high" }
  | { op: "hide"; containerId: string; clientIds: string[]; label: string };
export interface RenderPlan { id: string; pageId: string; createdAt: string; ops: RenderOp[]; summary: { moved: number; collapsed: number; unresolved: number; avgMovement: number; lifted?: number }; }
export declare function planRender(args: { pageId: string; ranked: RankedCandidate[]; options?: { annotate?: boolean; emphasizeThreshold?: number; collapseSponsored?: boolean; containerId?: string } }): RenderPlan;
export declare function validatePlan(plan: RenderPlan): { ok: true } | { ok: false; errors: string[] };
export declare function buildReason(ranked: RankedCandidate, profile: TasteProfile): RankedCandidate["reason"];
```

Invariants (each enforced by tests):

- Ranker orders by affinity descending. Unresolved candidates sink to the end and keep their original relative order. Ties break on `originalIndex` (stable sort). A missing affinity never produces a favorable score.
- Annotate text must be plain text, at most 140 characters, and must **reject** any string containing `<` (XSS guard). `validatePlan` enforces this plus op referential integrity (every `clientId`/`order` entry exists) and container-id shape.
- `containerId` must match `/^focal:[a-z0-9-]+$/i`.
- Explanations (`buildReason`, `contributions`, `tags`) may cite ONLY contributions/tags/entities actually present in the data handed to them. Never invent relationships, brands, or scores.
- The taste profile is server-side and persisted in Postgres (D-15). Requests carry identified items, never the raw profile blob; `localStorage` may hold only `/try` demo seeds, never the real profile.

## C. HTTP API — `apps/web`

Next.js route handlers are the only HTTP surface. The Qloo key lives in server env and never reaches the client.

```text
GET  /api/health   → { ok: true, hasQlooKey: boolean, dataSource: "live" | "mock" }
POST /api/qloo/search  body { query: string, types?: QlooEntityType[], location?: string }
                       → { entities: QlooEntity[], meta: { dataSource: DataSource, durationMs: number } }
Removed 2026-10-28 (D-17): POST /api/qloo/rank and the Studio /api/agent. The web's only
ranking surface is POST /api/try/rank (anonymous, lift-only) and POST /api/page/rank
(authenticated extension traffic); stdio MCP keeps the v1 pipeline until ported.
```

v2 route table. Auth: `bearer` = `Authorization: Bearer <extension token>`, `cookie` = website session, `anon` = no auth (IP rate-limited).

```text
POST /api/page/identify   bearer | { host, pathPattern, signature, cityHints[], cards[{clientId,snippets[]}] }
                         → { isList:boolean, pageType:InsightType|null, items:IdentifiedItem[], layout? }
POST /api/page/rank       bearer | { host, pageType, items:IdentifiedItem[] }
                         → { status, pageResultId:string|null, plan:RenderPlan|null, resolvedCount }
POST /api/feedback        bearer | { pageResultId, clientId, verdict:"more"|"less" }
                         → { saved:true, eventId:null } on no-op | { saved:true, entryId, eventId } on write
GET  /api/me              cookie | → { signedIn:false } | { signedIn:true, email }
GET  /api/activity?before cookie | → { activity:ActivityRecord[] }  (?before=<seq> cursor; no nextBefore)
POST /api/activity/[id]/undo  cookie|bearer | → { undone:true, eventId:string|null } | 404 | 409 later-change (bearer: actor "page" events only)
GET  /api/settings        cookie|bearer | → { sites:[{hostname,mode:"skip"|"off"}] }
PUT  /api/settings        cookie|bearer | { sites:[{hostname,mode:"skip"|"off"}] } → { sites }
POST /api/settings        cookie|bearer | { hostname, mode:"skip"|"off"|null } → { sites }   (null removes)
GET  /api/profile         cookie | → { entries }
POST /api/profile         cookie | { action:approve_rule|set_strength|remove, entry_id, strength? }
DELETE /api/profile       cookie | { confirm:"delete" } → { deleted:true } | 502 { error.code:"IDENTITY_DELETE_FAILED" } (data deleted, sign-in removal failed — retry)
GET  /api/profile/export  cookie | → JSON export incl. page_results
POST /api/extension/session  cookie | → { token, email, expiresAt }
DELETE /api/extension/session  bearer | → 204 (revokes the presented token)
POST /api/chat            cookie | { messages:[...] } → chat tool calls over the profile
POST /api/try/rank        anon | { pageType, items[{clientId?,name,city?}], seeds[] }
                         → { status, items (clientId echoed), plan, mock?, meta:{durationMs,unresolved,qlooRequest,dataSource} }
GET  /api/health          anon | → { ok:true, hasQlooKey, dataSource:"live"|"mock" }
POST /api/qloo/search     anon | { query, types?[], location? } → { entities, meta }
GET|POST|DELETE /mcp      hosted MCP (Streamable HTTP); 401 without auth
GET  /api/oauth/authorization-server  anon | OAuth metadata (hosted MCP discovery)
GET  /api/oauth/protected-resource    anon | OAuth metadata (hosted MCP discovery)
```

Removed 2026-10-28 (round 2): `GET /api/page/result/[id]` — orphaned; `/why` reads the store directly.

Data-flow rules (non-negotiable):

- Only these leave the browser: card text snippets (≤6 × 80 chars, ≤60 cards), the structure-only page signature, hostname and path pattern, city hints, identified items (name, type, city) and, for `/try`, the visitor's seeds. The profile lives on the server (D-15) and never travels from the browser. The server never receives page HTML, DOM dumps, screenshots, or form field contents — except a city taken from a location box or an "in <city>" phrase in a search box.
- `dataSource: "mock"` is reachable ONLY when `QLOO_MOCK=1`, and the UI must badge mock data loudly anywhere it appears.
- `meta.qlooRequest` records the upstream path + query params (key excluded) so the inspector can show exactly what was asked of Qloo.
- Invalid bodies are rejected with zod (400) before any upstream call.

## D. Mock vs live honesty + affinity conventions

- Affinity is `0..1` as returned by Qloo. Display it as `round(affinity*1000)/10` percent and always label it "Qloo affinity".
- `popularity` is a `0..1` percentile. It is NEVER summed with, substituted for, or blended into affinity.
- Missing affinity → the candidate is treated as unresolved for ranking purposes, never silently given a favorable score.
- No fabricated scores or relationships anywhere — in code, fixtures, tests, copy, or demo data.
- Mock fixtures are env-gated (`QLOO_MOCK=1`), carry `_fixture: "mock"`, derive from public Qloo documentation examples (for example the Balthazar place id `FCE8B172-4795-43E4-B222-3B550DC05FD9` from Qloo's public recipe), and are labeled in every UI surface that can render them.
- LLM features are OPTIONAL and resolve through the Groq → Cerebras → OpenRouter provider chain (chat defaults to `openai/gpt-oss-120b:free` on OpenRouter). With no provider key, narration features are disabled with an honest message; nothing else may break.

## B-appendix. Rank pipeline (added 2026-10-18)

Orchestration seam extracted from `apps/web` so every surface runs the same logic: seeds → resolve → one insights call → rank → plan. Search and insights are injected functions; `@focal-ai/core` still imports nothing from `@focal-ai/qloo`.

```ts
export interface PipelineSearchFn { (args: { query: string; types?: string[]; location?: string }): Promise<CoreEntity[]>; }
export interface PipelineInsightsFn { (args: { resultType: string; signalEntityIds: string[]; resultEntityIds?: string[]; locationQuery?: string; explainability?: boolean; take?: number }): Promise<{ scores: CandidateScore[]; request?: { path: string; params: Record<string, string> } }>; }
export interface RankPipelineArgs { pageId: string; pageType: string; locationQuery?: string; containerId?: string; candidates: PageCandidate[]; profile: TasteProfile; deps: { search: PipelineSearchFn; insights: PipelineInsightsFn }; planOptions?: { annotate?: boolean; emphasizeThreshold?: number; collapseSponsored?: boolean }; }
export interface RankPipelineResult { ranked: RankedCandidate[]; plan: RenderPlan; meta: { unresolved: number; insightsCalls: number; qlooRequest?: { path: string; params: Record<string, string> } }; }
export declare class PipelineError extends Error { code: "NO_SEEDS" | "PLAN_INVALID"; }
export declare function runRankPipeline(args: RankPipelineArgs): Promise<RankPipelineResult>;
```

The web's lift-only page rank and the MCP `score_candidates` tool share the core pipeline; adapters (search/insights injection, request building, error mapping) live at the edges.
