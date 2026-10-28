# Testing & verification — focal.ai

How the repo is tested and what each layer proves. Dev workflow: [development.md](./development.md). System under test: [architecture.md](./architecture.md).

## 1. Suites

Vitest per package plus one Playwright e2e suite. Counts from the last full run (2026-10-28, `DATABASE_URL` set):

| Suite | Tests | What it covers |
| --- | --- | --- |
| `@focal-ai/web` | **153** | API routes (page identify/rank/result, feedback, profile incl. export/delete + set_strength/remove, settings with cookie + bearer auth, activity, chat, MCP deps, try/rank parity), resolution cache (hit/stale/error paths), learned-layout derive/apply + no-second-identify, pages helpers. DB-backed cases run against Postgres. |
| `@focal-ai/core` | **120** | Profile v2 codec + write functions (add/change/remove/undo/approve), activity events, signal selection, resolver, lift rule, plan compiler + validator, grounded labels, page pipeline. |
| `@focal-ai/qloo` | **63** | Client params/parsing/error taxonomy/retry/TTL cache, the fixture mock, and the process-wide 200 ms pace gate (concurrent calls stay ≥180 ms apart). |
| `@focal-ai/db` | **14** | Repo round-trips, migrations, and cascade-on-user-delete (entries, activity, sites, page results, extension_sessions). Skips without `DATABASE_URL`. |
| `@focal-ai/mcp` | **24** | Hosted + stdio server behavior; the stdio smoke test spawns the real server (`process.execPath --import tsx`) so it works on any platform. |
| `@focal-ai/extension` | **73** | Guards (never-run, sensitive fields), detection, snapshot limits, apply/undo/fold/labels, feedback buttons, layout store + apply, settings sync mapping, content-script run flow. |
| `pnpm e2e` | **6** | See §3. |

## 2. Run

```bash
pnpm -r typecheck          # web runs next typegen + tsc
pnpm -r test               # DB suites need DATABASE_URL=postgres://focal:focal@localhost:5432/focal
pnpm e2e                   # §3 — needs DATABASE_URL for the feedback spec
pnpm --filter @focal-ai/web build
pnpm --filter @focal-ai/extension build
```

## 3. End-to-end (`e2e/`)

`pnpm e2e` runs `playwright test -c e2e/playwright.config.ts`. The config:

- starts `next dev` on :3100 with `QLOO_MOCK=1` (and `DATABASE_URL` forwarded — feedback requires a real profile store),
- starts a self-signed HTTPS fixture server on :8443 (`e2e/fixture-server.mjs`, cert generated at startup with `selfsigned`),
- builds the extension with `FOCAL_ORIGIN=http://localhost:3100` in `global-setup.ts`, and — when `DATABASE_URL` is set — migrates, upserts a user, issues a real `fx_` session, and seeds the two mock profile seeds (Fugazi, Rintaro) idempotently,
- launches a persistent Chromium context (`channel: "chromium"`, extension-capable headless) with `--load-extension`, `--host-resolver-rules=MAP * 127.0.0.1,EXCLUDE localhost`, `--ignore-certificate-errors`, then seeds the session into `chrome.storage.local` through the service worker,
- captures every extension request/response to `localhost:3100/api/*` for assertions.

Specs (`e2e/specs/extension.spec.ts`):

1. Password-field page → **zero** identify/rank requests.
2. Never-run host (`bank.test`) → **zero** identify/rank requests.
3. Detect→identify→rank→apply: lifted card on top with a label, others in original order, exactly one identify + one rank call.
4. Undo restores the original order (polled past the FLIP animation).
5. "More like this" → real click → 200 `/api/feedback` + "Saved · Undo"; a labelled-card screenshot lands in `e2e/artifacts/` (gitignored).
6. Second visit to the same layout sends **no** identify request (learned layout), still ranks.

No network anywhere — fixtures serve `.test` hosts over HTTPS, the web app runs mock Qloo, and host-resolver rules keep everything on 127.0.0.1. CI runs the same suite in the `e2e` job (postgres service + `playwright install --with-deps chromium`).

## 4. What fixtures prove — and don't

- The Qloo mock and the mock identifier make ranking deterministic, so e2e asserts exact lift order. They prove the loop end to end, not live-API accuracy.
- Order assertions read **visual** position (`getBoundingClientRect`) because apply uses CSS `order` on flex containers — DOM order is intentionally untouched there.
- The feedback path is proven against real Postgres (route requires a DB; without `DATABASE_URL` the web app still serves identify/rank in dev-session mode but the feedback spec can't run).

## 5. Release gate (unchanged)

Frozen install → `pnpm -r typecheck` → `pnpm -r test` (with `DATABASE_URL`) → `pnpm e2e` → web + extension builds → secret scan of build output. A wave is not done until the gate passes.
