# Architecture — focal.ai

The product is a Chromium MV3 extension plus a Next.js website/backend. This is the system as built — the spec lives in [spec.md](./spec.md), the backlog in [tickets.md](./tickets.md).

## Shape

```
apps/
  web/          Next.js 16 App Router — website + all API routes + hosted MCP
  extension/    MV3 extension — content script, background service worker, popup
packages/
  core/         Profile v2 + activity-event write functions, lift rule, plan compiler, page pipeline
  qloo/         Typed Qloo client: search, insights, tags, entities; retry, 5 req/s pacer, fixture mock
  db/           Postgres repos + migrations (profiles, activity, sites, page results, sessions, layouts, resolutions)
  mcp/          MCP server — hosted (Streamable HTTP at /mcp) and local stdio variants
e2e/            Playwright suite — extension in real Chromium against a local app + HTTPS fixtures
```

## The page pipeline (the product loop)

```
guards → detect → identify → rank → apply — all initiated by the content script
```

1. **Guards** (`apps/extension/src/guards/`): URL scheme, built-in never-run categories (banking, health, government, email, messaging, documents, passwords, sign-in, focal), the user's skip/off lists (server-owned, cached locally), incognito preference, and password/payment-field presence. All local — a blocked page sends nothing anywhere.
2. **Detect** (`apps/extension/src/detect/`): finds the dominant group of ≥3 repeated sibling cards by structure signature and snapshots up to 60 — snippets (≤6 × ≤80 chars), link hosts/paths (≤4), city hints from URL/search inputs (≤5). No HTML, forms, or screenshots leave the page.
3. **Identify**: first, a learned layout lookup (`apps/extension/src/layouts/`, chrome.storage, ≤200 entries keyed `host|pathPattern|signature`) — a match answers locally with zero requests. Otherwise `POST /api/page/identify` (extension bearer session) → the TypeSafe Jev identifier (mock in dev) types the page and names each card; the server derives a structure-only layout and returns it; layouts are stored only in the extension (D-18) — the server never persists them.
4. **Rank**: `POST /api/page/rank` → `runPageRank` (`packages/core/src/pagePipeline.ts`): resolve item names to Qloo entities (with a shared Postgres resolution cache — `apps/web/lib/server/resolution/cache.ts` — at the resolver-outcome level: resolved/ambiguous forever, unresolved 7-day TTL, errors never cached), score with one insights call against the profile's signal selection, decide lifts by z-score (`lift.ts` — lifted means a clear positive outlier among scored items; needs ≥minScored), build grounded labels ("Top pick for you · because you like Fugazi" — cites only real contributions), compile a declarative plan (`reorder`/`annotate`/`emphasize`/`collapse`/`hide`), and save the PageResult for 24 h (`/why/<id>` and feedback read it back).
5. **Apply** (`apps/extension/src/apply/`): `applyPlan` reorders via CSS `order` on flex/grid containers or node moves otherwise — nodes are never recreated, so site handlers survive. Lifted cards get a `<focal-label>` badge plus More-like-this / Not-for-me buttons; a strip shows "focal lifted N for your taste" with Undo and Why this order. A MutationObserver re-runs on list changes (debounced, capped at 6/min); stale generations are dropped.

**Feedback**: buttons → content → background → `POST /api/feedback` (bearer). The server reads the saved PageResult — the entity and type come from it, never from the client — and writes a like/dislike through the same core write functions chat and MCP use (actor `page`, version-guarded, undoable from the page or via `POST /api/activity/[id]/undo`).

## Website (`apps/web`)

- Pages: `/` landing, `/try` playground, `/onboarding`, `/chat`, `/profile`, `/activity`, `/settings`, `/connect`, `/why/[id]`, `/privacy`.
- Key routes: `/api/page/{identify,rank,result}`, `/api/try/rank` (unauthenticated, per-IP limited, transient — same `rankPage` as the authed route), `/api/feedback`, `/api/profile` (+ `/export`), `/api/settings`, `/api/activity`, `/api/chat`, `/mcp`, `/api/extension/session`.
- Auth: WorkOS AuthKit cookies for the site (`currentViewer`); `fx_` bearer tokens (`extension_sessions`) for the extension and MCP (`resolveSession`). `FOCAL_DEV_SESSION=1` resolves any bearer to a dev profile when no DB is configured.
- Profile v2 (`packages/core`): entries (thing/vibe/rule, strengths love/like/dislike), version-guarded commits, every write emits an ActivityEvent with an actor (chat, mcp:<client>, page, manual) that `/activity` renders and `/api/profile` undo reverses.

## Data (Postgres, `packages/db`)

users + `profile` JSONB + version; `activity` (the undoable event log); `site_settings`; `page_results` (24 h expiry); `extension_sessions`; `layouts` (structure-only); `resolutions` (entity + status + updatedAt). Every `user_id` FK cascades on delete — account deletion kills sessions, settings, results and the profile. No-DB mode keeps limited in-memory equivalents.

## Qloo (`packages/qloo`)

One client for search/insights/tags/entities with an error taxonomy, timeout/retry, and a module-level pacer that starts at most one request per 200 ms process-wide — every server call (identify, rank, chat tools, MCP) goes through it. `QLOO_MOCK=1` swaps in the fixture mock for offline dev and the whole e2e suite; mock output is labelled end to end.

## MCP (`packages/mcp`)

Hosted Streamable-HTTP server at `/mcp` (AuthKit OAuth + `fx_` bearer): 9 tools over the same profile write functions — `read_profile`, `taste_summary`, `search_entities`, `add_thing`, `add_vibe`, `propose_rule` (rules land pending until approved on `/profile`), `remove_entry`, `recommend`, `rank_list`. Local stdio variant for development, read-only.

## Boundaries that hold

- Eligibility is decided **before extraction** — guards never need the network.
- Only bounded card snapshots (names/snippets/link refs/city hints) leave the page; never HTML, forms, screenshots, or browsing history.
- Plans are **declarative** — the server returns ops, never selectors or code; learned layouts hold structure only.
- Lift-only: the plan moves matches up and preserves the rest; it never hides site content and never injects content the site didn't have.
- All keys (Qloo, TypeSafe, LLM, WorkOS) are server-only; the extension talks to focal's own API with its session token.
