# Project status — focal.ai

**Last updated:** 2026-10-18
**Team:** repo owner + autonomous coding agents (waves run as parallel agent batches, each closed by an independent release-verifier pass — see "Verification model" and `docs/testing.md`).
**Hackathon deadline:** October 30, 2026, 11:45pm EDT (Qloo Agentic Hackathon). Target submission: Oct 29, one day early.
**Repo state:** 7 local commits ahead of `origin/main`, never pushed: `18cd0cd` (W1+W2), `8d18351` (W3), `0af7a62` (docs), `8f7c909` (W4a), `8f8aeee` (W4a docs), `473f91d` (W4b), and this docs commit — all on top of `4532f11`.

## Current state

The hosted "Focal Studio" web app is implemented and verified end-to-end in mock mode: a taste profile (seed picker with search, persistence under `focal.profile.v1`) drives three demo pages — Tables (12 SF restaurants, 2 sponsored), Atlas (Lisbon hotels), Verve (brands) — through `/api/qloo/rank` and `/api/qloo/search`, with a ranked surface (Original / Focal / Diff), a diff strip fed by `plan.summary`, and an inspector (plan / request / evidence). A fourth Paste tab (T-17) ranks an arbitrary pasted list through the same pipeline, and `/api/qloo/rank` re-validates every compiled plan at runtime before responding. The rank orchestration now lives in `@focal-ai/core` (`runRankPipeline`) and is shared by the web routes and the MCP server. The Studio agent (T-19) answers from an Ask-focal panel (tool timeline, approval cards, "Apply to profile") via `/api/agent` — rank / explain / discovery / policy intents, deterministic without an LLM. The `@focal-ai/mcp` stdio server (T-20) exposes 6 read-only tools with a documented Claude Desktop config. The engine packages are green: 209 passing tests (core 82, qloo 46, mcp 13, web 68). The browser extension is not yet implemented. Everything runs against `QLOO_MOCK=1` fixtures today — live-data verification is waiting on the Qloo hackathon key.

## Wave history

| Wave | Dates | What landed | Commit / evidence | Verification |
| --- | --- | --- | --- | --- |
| Recon + plan | Oct 17 | Repository audit (docs-only scaffold), Qloo API research from official docs, full technical plan | Became `docs/tickets.md` (25 tickets) and `docs/contracts.md` (frozen interfaces) | Plan reviewed against the repo tree; contracts frozen before code |
| Wave 1 — foundation | Oct 17 | pnpm monorepo scaffold (`apps/web` Next.js 16.4.2, `packages/{qloo,core,mcp}`, CI, dev scripts, probe script) + `docs/tickets.md` (25 tickets) + `docs/contracts.md` (frozen interfaces) + `docs/qloo-contract.md` template | `18cd0cd` — 69 files, +10,323/−6 | Frozen install, typecheck, build, CI config, probe stub |
| Wave 2 — engine | Oct 17 | `@focal-ai/qloo` typed client (search / insights / tags / entities, error taxonomy, retry + TTL cache, defensive affinity extraction, fixture mock) + `@focal-ai/core` engine (profile codec, city-aware resolver, ranker, plan compiler / validator, grounded evidence) — 117 tests at the time | Included in `18cd0cd` after a verified fix | Independent verifier caught a Turbopack `.js`-import defect; fixed, then frozen install + tests + build green |
| Wave 3 — Studio | Oct 18 | Studio UI + API routes (`/api/qloo/rank`, `/api/qloo/search`), demo page data (Tables / Atlas / Verve), ranked surface + diff strip + inspector, mock fixture realism fix (subtype `urn:entity:place`, broader mock search), Next 16 prerender fix (`SSR_EMPTY_PROFILE`), lint cleanup — 139 tests total | `8d18351` — 37 files, +2,341/−98 | Full release-verifier pass: typecheck 4/4, tests core 72 / qloo 46 / web 21, web build green, lint 0 errors, probe exits 2 (no key, friendly message), MCP stub exits 0, no key material in client bundles, runtime mock smoke (rank returns Rintaro at 93% match, 1 correctly unresolved) |
| Wave 4a — paste + integrity | Oct 18 | Paste-any-list for arbitrary lists (per-line parser + statuses, Paste tab; T-17), runtime `validatePlan` gate on `/api/qloo/rank`, mock badge precedence fix (`dataSource === "mock"` wins over a missing key), "Demo directory" disclosure chip, +12 paste tests → web total 33 | `8f7c909` — 11 files, +361/−32 | Release-verifier pass (2026-10-18): typecheck 4/4, tests core 72 / qloo 46 / web 33 (151 total), web build green, lint 0 errors, probe exit 2, MCP stub exit 0, no key material in `.next/static`, runtime mock smoke (ranked 3, Rintaro 93%, 1 unresolved, `/v2/insights`; invalid body → 400) |
| Wave 4b — agent + MCP | Oct 18 | Shared rank pipeline extracted to `@focal-ai/core` (`runRankPipeline`, the same seam runs web and MCP); Studio agent (T-19): `/api/agent` intent router (rank / explain / discovery / policy, deterministic without an LLM) + Ask-focal panel with tool timeline, approval cards and "Apply to profile"; `@focal-ai/mcp` stdio server (T-20): 6 read-only tools + Claude Desktop config; 209 tests total | `473f91d` — 26 files, +3,632/−106 | Release-verifier pass (2026-10-18): frozen install; typecheck 4/4; tests core 82 / qloo 46 / mcp 13 / web 68 (209 total); web build green (`ƒ /api/agent`, "Ask focal" + "Inspector" in the shell, `Loading…` fallback gone); lint 0 errors; probe exit 2; MCP stdio server stays up with 0-byte stdout; static scan clean (1 benign UI-copy hit); runtime mock smoke: rank → Rintaro 93%, 1 unresolved, `/v2/insights`; agent rank/policy/discovery kinds with expected steps; `{}` → 400 |

## Verification model

Every wave ends with an independent release-verifier pass — run by agents that did not write the code. Checks: frozen install (`pnpm install --frozen-lockfile`), typecheck, test suites, production build, lint, probe script exits 2 without a key, MCP stdio smoke (server stays up, stdout carries protocol traffic only), secret scan of build output, and a runtime mock smoke against a live server. The full procedure lives in `docs/testing.md`. The model has caught 2 real defects before commit: a Turbopack `.js`-import defect (Wave 2) and fabricated fixture subtype data (Wave 3).

## Open blockers / decisions needed

1. **Qloo hackathon key not received.** Requested via https://forms.gle/zz12orkLHTAneLGz6 (a few business days; check spam). Blocks T-01 (live contract freeze) and the live demo; all other work proceeds on mock fixtures.
2. **Anthropic key absent.** LLM-powered features (T-19) stay optional and degraded by design — deterministic tool-plan runner with an honest UI explanation. Not a blocker.
3. **Deployment account not chosen.** Vercel is the default plan (T-23); the app stays 12-factor so the Docker fallback is cheap.
4. **Push access to `tsangh5/focal.ai` unconfirmed.** All work exists as local commits only; nothing has been pushed.

## Next up

- **Wave 5:** hardening + CSP (T-21), Playwright e2e + live smoke (T-22), deploy + prod smoke (T-23), README rewrite + Devpost submission materials (T-24).
- **Remaining open:** T-18 error / empty / rate-limit state polish (Partial), and T-01 — live Qloo contract probe, pending the hackathon key.

## How to update this file

Append one row to the wave table per wave or commit and refresh the "Current state" paragraph. Record the commit hash and the verifier's evidence for anything you add. Keep the file under ~150 lines.
