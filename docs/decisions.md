# Decision log — focal.ai

ADR-style record of the decisions that shaped this build. Follows [contracts.md](./contracts.md); architecture is described in [architecture.md](./architecture.md). Statuses: **Accepted** (in force), **Deferred** (post-hackathon), **Pending** / **Pending-verification** (blocked on an external event), **Amended** / **Superseded** (changed by a later decision, named in the status line).

---

## D-1 · Hosted Studio is the core submission journey; extension deferred

**Date:** 2026-10-17 · **Status:** Superseded by D-15 (2026-10-20): the extension is the product; the Studio pages become the `/try` playground

**Context.** The hackathon requires a hosted, end-to-end usable demo. Browser-extension distribution (store review) cannot ship in time; the README's extension-first narrative describes the intended product.

**Decision.** The submission's core journey is the hosted Studio: in-app demo directory pages now, paste-a-list input later (T-17). The MV3 extension moves to the post-hackathon roadmap (T-25, P2); the MCP server stays a local-only stub (T-20).

**Alternatives considered.** Extension as the main artifact; MCP-first demo.

**Consequences.** Only the hosted app is judged; README claims beyond it are aspirational. Demo "pages" are structured in-repo fixtures, not live sites — the DOM-rewrite pipeline is not implemented anywhere in this repo.

---

## D-2 · Stateless server with a browser-local profile

**Date:** 2026-10-17 · **Status:** Superseded by D-15 (2026-10-20): the profile lives on the server with accounts so the extension, the website chat and outside assistants share it

**Context.** Accounts and a database add build time and weaken the privacy story; nothing in the demo needs cross-device state.

**Decision.** No DB, no accounts, no server-side profile persistence. The profile lives in browser `localStorage` under `focal.profile.v1`, travels with each rank request, and is discarded after the response. Export JSON and clear-all live in the profile panel.

**Alternatives considered.** Postgres/SQLite with accounts; cookie sessions.

**Consequences.** Strongest privacy story and zero provisioning. The only server memory is best-effort in-process state (qloo TTL cache, rate-limit map) that resets on restart — acceptable for the hackathon, documented here rather than hidden.

---

## D-3 · LLM features optional by design

**Date:** 2026-10-17 · **Status:** Amended by D-15 (2026-10-20): the website chat agent runs on an open-weight LLM and card identification uses Jev; ranking and render plans stay deterministic

**Context.** No Anthropic key was available at build time; a judged demo must not depend on one.

**Decision.** Every shipped flow is deterministic and fully functional without any LLM. When a key exists, LLM features (agent loop T-19: intent parsing, policy copy) are additive; without one, they degrade honestly (deterministic output or a disabled feature with a clear message).

**Alternatives considered.** Hard dependency on Anthropic; skipping LLM entirely.

**Consequences.** As built, zero LLM code paths exist — `.env.example` declares `ANTHROPIC_API_KEY` but nothing reads it; `POST /api/agent` is unimplemented (contract TBD, T-19). Mock/live data-source honesty is independent of LLM availability.

---

## D-4 · Mock mode contract

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** Engine and UI needed to proceed without the Qloo key (T-01 blocked), without ever passing fixtures off as live data.

**Decision.** Mock is reachable only when `QLOO_MOCK=1` (guard inside `createQlooClient`). Fixtures are hand-authored, derive from public Qloo doc examples, and every fixture root carries a `_fixture` marker that the mock client echoes in responses. The UI badges mock data (status pill `MOCK DATA` when a key is configured; the Inspector `source` chip always shows the per-response `dataSource`). Mock never ships enabled; the judged demo requires live data.

**Alternatives considered.** Silent fixtures; per-call mock switches exposed to the client.

**Consequences.** Mock search only substring-matches fixture names (other candidates stay unresolved but still render); live smoke and fixture finalization remain blocked on the key (T-22).

---

## D-5 · Source-consumed workspace packages (no dist builds)

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** Solo-agent pace favors one source of truth over a build pipeline; consumers are a bundler (Next/Turbopack) and `tsx`.

**Decision.** `@focal-ai/qloo` and `@focal-ai/core` export TypeScript source directly (`main`/`types`/`exports` → `src/index.ts`); no `dist/`. Next consumes them via `transpilePackages: ["@focal-ai/core", "@focal-ai/qloo"]`; the MCP package runs through `tsx`.

**Alternatives considered.** tsup/tsc dist builds per package; publishing to npm now.

**Consequences.** Fast iteration and no stale artifacts. Revisit before npm publishing or any non-bundler consumer; typecheck per package (`tsc --noEmit`) is the stand-in for a build step.

---

## D-6 · @focal-ai/core stands alone (no dependency on @focal-ai/qloo)

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** Contract Block B froze the engine as pure/deterministic and framework-free; parallel development and full fake-driven testing depend on it.

**Decision.** `@focal-ai/core` imports nothing from `@focal-ai/qloo` (zod only). `apps/web` and eventually MCP adapt between the two packages via the injected `CoreSearchFn` seam plus mapping functions (`apps/web/lib/server/adapters.ts`).

**Alternatives considered.** A shared types package; letting core import qloo types directly.

**Consequences.** The engine is unit-testable with plain fakes and cannot accidentally take a network dependency. `CoreEntity` vs `QlooEntity` duplicate a shape on purpose; the adapter layer is the single place where the two meet.

---

## D-7 · Ranking contract: raw Qloo affinity only

**Date:** 2026-10-17 · **Status:** Amended by D-15 (2026-10-20): ranking lifts only items clearly above the page average and leaves the rest in site order; labels are page-relative words, with raw affinity shown in "Why this order?". Raw affinity remains the only score

**Context.** The product promise ("ranked by what you like") is only credible if scores are real, legible, and never invented.

**Decision.** Order by raw Qloo affinity, descending; display `affinityPct = round(affinity*1000)/10` (0–100). Unresolved items sink to their own buckets and never receive favorable scores; missing affinity never produces a score or a boost. `popularity` is carried through the adapter but never summed into ranking or the displayed percent. Explanations cite only contributions that were actually returned and map to profile seeds.

**Alternatives considered.** Blending popularity; LLM re-ranking; inventing fallback scores.

**Consequences.** Rule boosts affect only local order (`ruleEffects`), never the displayed percent; ties are stable on `originalIndex`; every branch is pinned by core tests. Note: the Studio UI does not currently display `popularity` at all.

---

## D-8 · Strict subtype matching in the resolver

**Date:** 2026-10-17 · **Status:** Verified (2026-10-19)

**Context.** The resolver must never guess an entity. Qloo types are `urn:entity:*`; the real per-result `subtype` value on the live API is unknown until the T-01 probe runs.

**Decision.** Accept a search hit only when `entity.subtype === expectedType` (exact string) plus a normalized-name match (packages/core/src/resolve.ts). Pages send `pageType` = `urn:entity:place` / `urn:entity:brand`; mock fixtures use matching `urn:entity:*` subtypes.

**Alternatives considered.** Fuzzy subtype matching; matching on type prefix; accepting ambiguous hits.

**Consequences.** After T-01 confirms the live subtype values, pages/fixtures/parsers may need updating — decided by the probe record, not by code tweaks. An initial mock-fixture mismatch (`urn:place:restaurant` vs `urn:entity:place`) resolved everything to "unresolved"; fixtures were fixed, which is how this convention was caught. **Outcome (live probe, 2026-10-19).** Live search omits `subtype`, so the mapper falls back to `types[0]`; live insights `subtype` equals the entity-type URN; fixtures are aligned; resolver logic is unchanged.

---

## D-9 · Render plans are declarative enum ops only

**Date:** 2026-10-17 · **Status:** Accepted; amended by D-15 (2026-10-20): learned page layouts contain structural positions used by the extension's own code, never inside render plans

**Context.** The extension vision (arbitrary per-site selectors/JS) is a safety and scope liability; the Studio only needs a portable, inspectable plan.

**Decision.** Plans contain only five ops: `reorder`, `collapse`, `annotate`, `emphasize`, `hide` (closed `RenderOp` union). The route boundary zod-enumerates the request-side vocabularies (profile rule kinds), and `validatePlan` in core is the plan-level checker: container-id shape (`/^focal:[a-z0-9-]+$/i`), annotation limits (plain text, ≤140 chars, no `<`), and referential integrity. No selectors, no scripts, no arbitrary expressions.

**Alternatives considered.** CSS-selector-based policies; user-authored JS (the rejected README draft).

**Consequences.** Plans are data and portable to future surfaces. As built, `validatePlan` is test-enforced but not invoked at runtime by the rank route; the Studio applies the order via `ranked.position` and displays the plan in the Inspector rather than executing DOM ops.

---

## D-10 · Next 16 `cacheComponents` prerender fix for render-time `new Date()`

**Date:** 2026-10-18 · **Status:** Accepted

**Context.** With `cacheComponents` enabled, the `/` prerender rejected `new Date()` executed during render; `createEmptyProfile()` calls it, and `useProfile`'s state initializer ran on the server.

**Decision.** `lib/client/store.ts` uses a module-level frozen `SSR_EMPTY_PROFILE` constant on the server path and loads the real profile in a mount `useEffect`; one documented eslint suppression (`react-hooks/set-state-in-effect`) marks the deliberate hydration-safe load.

**Alternatives considered.** Dropping `cacheComponents`; a `<Suspense>` boundary (tried — made the static HTML a loading fallback); un-suppressed lint.

**Consequences.** Static HTML for `/` shows the empty-profile shell, then hydrates to the stored profile; tests must not assert server HTML for profile-dependent UI. If the store ever defers profile creation fully past render, the suppression can be removed.

---

## D-11 · Extensionless relative imports inside packages

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** A `.js`-suffixed relative import in core (`./profile.js` style, as NodeNext requires) broke the Next/Turbopack build when transpiling workspace TS source.

**Decision.** Packages use extensionless relative imports (`./client`, `../fixtures/entities.json`) with `moduleResolution: "Bundler"` in `tsconfig.base.json`.

**Alternatives considered.** NodeNext with `.js` specifiers; building dist artifacts.

**Consequences.** Packages target bundlers and `tsx`, not bare Node ESM. Revisit together with D-5 before npm publishing.

---

## D-12 · Testing posture: vitest now, Playwright + live smoke deferred

**Date:** 2026-10-18 · **Status:** Accepted

**Context.** Key-independent work must be verifiable today; e2e infrastructure and live endpoints are both blocked or unaffordable in the current window.

**Decision.** vitest unit/integration per package — core 72 tests, qloo 46, web 21 (re-verified 2026-10-18; mcp none). CI runs frozen install + typecheck + test + web build on every push/PR to `main`. Playwright e2e and the live smoke script are planned (T-22), and every build wave ends with an independent verifier pass before the next wave starts.

**Alternatives considered.** E2E-first; no test suite until after the key arrives.

**Consequences.** CI is network-free and fast; resolver/route/mock behaviors are pinned by tests (e.g. subtype resolution, key never in responses). Browser-level regressions and live-Qloo behavior remain unverified until T-22 and T-01.

---

## D-13 · Vercel as the default deploy target

**Date:** 2026-10-18 · **Status:** Pending

**Context.** The submission needs a hosted URL; no account/domain existed at decision time.

**Decision.** Deploy `apps/web` to Vercel with server-only env (`QLOO_API_KEY`, `QLOO_API_BASE`, optional `ANTHROPIC_API_KEY`) and `QLOO_MOCK=0` in production, wiring `/api/health` as the readiness check (T-23). If Vercel is unavailable, fall back to Docker on fly.io/render from the same 12-factor config.

**Alternatives considered.** Docker-first; static export (impossible — API routes need a server); other PaaS.

**Consequences.** Nothing is deployed yet: no `vercel.json`, `Dockerfile`, or prod smoke artifacts exist in the repo; the hosted URL remains a hard gate in the definition of done.

---

## D-14 · No pushes to `tsangh5/focal.ai` from this machine yet

**Date:** 2026-10-18 · **Status:** Superseded (2026-10-19): push access was resolved and all waves are on `origin/main`

**Context.** `origin` is `https://github.com/tsangh5/focal.ai.git`; push rights from this machine are unconfirmed.

**Decision.** Work is committed locally on `main` only; as of the wave-3 verification the branch is 2 commits ahead of `origin/main` (`18cd0cd`, `8d18351`). No push, no PR, until rights are confirmed.

**Alternatives considered.** Pushing immediately; forking.

**Consequences.** Remote CI has not run for waves 2–3 (nothing was pushed from this machine; local checks stand in) and `origin/main` lacks those commits. When pushing is unblocked, the first push should be preceded by a fresh secret scan — `.env*` is gitignored, and route tests assert the key never appears in responses.

---

## D-15 · Extension-first product with a server-side profile

**Date:** 2026-10-20 · **Status:** Accepted (spec merged in PR #1, 2026-10-20)

**Context.** The hosted Studio demonstrates the ranking engine on in-repo demo pages, but the product promise is re-ordering the real websites people already use. The team decided to build that product for the hackathon rather than after it.

**Decision.** Build the browser extension described in [spec.md](./spec.md): automatic list detection on any site, Jev-assisted identification with learned layouts, lift-only ranking with labels, a profile of things, vibes and hard rules written by a website chat agent and by outside assistants over a hosted MCP endpoint, and accounts with the profile stored on the server. The spec's §10 lists the 26 decisions behind this.

**Alternatives considered.** Submitting the Studio and building the extension afterwards; hand-written per-site adapters; a browser-local profile with a local-only MCP bridge.

**Consequences.** Supersedes D-1, D-2 and D-14; amends D-3, D-7 and D-9. Adds a database, sign-in, a Jev dependency and an LLM dependency. The previous backlog moves to [archive/tickets-studio.md](./archive/tickets-studio.md) and [tickets.md](./tickets.md) becomes the extension backlog. Open technical questions are tracked in spec §8 and settled by `pnpm probe:unknowns`.

---

## D-16 · WorkOS AuthKit for sign-in and MCP OAuth; Neon for Postgres

**Date:** 2026-10-20 · **Status:** Accepted (implemented in PRs #6 and #8; the connector OAuth check runs in M-03)

**Context.** Spec decision 16 needs Google and email-link sign-in from a service that is also an OAuth 2.1 authorization server for MCP connectors (resource indicators, Client ID Metadata Documents, dynamic client registration for older clients), on a free tier, working on Vercel. Decision 7 needs hosted Postgres.

**Decision.** WorkOS AuthKit: hosted sign-in, CIMD, DCR and resource indicators for `/mcp`, free up to 1M monthly active users. The extension never holds a provider token: the website issues an opaque, revocable extension session (stored hashed in Postgres) and hands it over through `externally_connectable`. Postgres is Neon via the Vercel Marketplace (free plan with scale-to-zero, a branch per preview).

**Alternatives considered.** Clerk (smaller free tier), Better Auth (self-hosted, never enables DCR), Supabase Auth (couples auth to Supabase; free projects pause), Stytch; Supabase or Vercel Postgres for the database. Evidence: [auth-and-db.md](./auth-and-db.md).

**Consequences.** Production needs the WorkOS variables plus `WORKOS_AUTHKIT_DOMAIN` and `FOCAL_PUBLIC_URL`, and the dashboard steps in [deployment.md](./deployment.md) §4. V-04's last acceptance item, a ChatGPT or claude.ai connector completing OAuth, runs in M-03.
