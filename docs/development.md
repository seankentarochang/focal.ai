# Development — focal.ai

How to run and work on this repo. Architecture: [architecture.md](./architecture.md). Testing: [testing.md](./testing.md). Backlog: [tickets.md](./tickets.md).

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node | `>=22` (`engines`); `.nvmrc` pins `24` | |
| pnpm | `12.4.2` (`packageManager`) | `corepack enable` picks it up automatically |
| Postgres | 17 | Any local instance or `postgres:17-alpine` in Docker; needed for DB tests and the e2e feedback spec |
| Chromium | via Playwright | `pnpm exec playwright install chromium` for `pnpm e2e` |

Windows note: the global `pnpm.cmd` shim can be broken on some machines — call `pnpm -r <script>` directly rather than the root `pnpm test`/`pnpm lint`/`pnpm check` wrappers, and see `e2e/playwright.config.ts` for how spawned processes avoid `pnpm` entirely.

## 2. Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
```

`.env` / `.env.*` are gitignored except the `.example` files. Keys are read only by server modules under `apps/web/lib/server/` and `packages/` — never by client or extension code.

| Variable | Used by | Required? |
| --- | --- | --- |
| `QLOO_API_KEY`, `QLOO_API_BASE` | `@focal-ai/qloo` (page rank, chat tools, MCP) | Live taste data; `QLOO_MOCK=1` runs offline fixtures |
| `QLOO_MOCK` | qloo client + identify route | Local/CI only — never set in production |
| `TYPESAFE_API_KEY` | `/api/page/identify` (Jev identifier) | Live identification; falls back to the mock identifier |
| `DATABASE_URL` | `@focal-ai/db`, all persisted routes | Yes in production; unset → limited no-DB/dev mode |
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `WORKOS_AUTHKIT_DOMAIN` | Sign-in + MCP OAuth | For accounts; `FOCAL_DEV_SESSION=1` skips auth in dev |
| `NEXT_PUBLIC_FOCAL_EXTENSION_ID` | `/connect` session hand-off | Needed for the website→extension token hand-off |
| `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY` | `/api/chat` provider chain | One needed for chat; tried in order, fails over on 429/5xx |
| `FOCAL_PUBLIC_URL` | `/mcp` OAuth metadata | Production only |
| `FOCAL_ORIGIN` | extension `build.mjs` | Build-time only — the API base baked into `dist/` |

## 3. Run

```bash
# web app — zero keys needed with mock + dev session
cd apps/web && QLOO_MOCK=1 FOCAL_DEV_SESSION=1 pnpm dev     # http://localhost:3000

# extension — build against the local app, load dist/ unpacked (chrome://extensions, dev mode)
cd apps/extension && FOCAL_ORIGIN=http://localhost:3000 pnpm build

# zip for sharing/CI artifact
pnpm --filter @focal-ai/extension zip

# database migrations (when DATABASE_URL is set)
pnpm --filter @focal-ai/db migrate
```

The dev session resolves any bearer token to a demo profile (Fugazi + Rintaro seeds), so the extension works locally without signing in. Sign-in itself needs the WorkOS variables; an empty signed-in profile is routed to `/onboarding` after `/auth/callback` → `/post-sign-in`.

## 4. Command reference

| Command | Runs |
| --- | --- |
| `pnpm -r typecheck` / `pnpm -r test` / `pnpm -r lint` | Across all packages (DB tests skip without `DATABASE_URL`) |
| `pnpm e2e` | Playwright suite — starts the web app + HTTPS fixtures, loads the extension, 6 specs |
| `pnpm --filter @focal-ai/web build` / `dev` / `start` | Web app |
| `pnpm --filter @focal-ai/extension build` / `zip` | Extension (`build.mjs` via esbuild) |
| `pnpm --filter @focal-ai/db migrate` | Migrations |
| `pnpm probe` | Live Qloo contract probe (needs `QLOO_API_KEY`) |

## 5. Where to edit what

| Change | Edit |
| --- | --- |
| Extension: guards/detect/apply/layouts/settings | `apps/extension/src/{guards,detect,apply,layouts}/`, `content.ts`, `background.ts` |
| Page pipeline: lift rule, labels, plan, resolution | `packages/core/src/{lift,pagePipeline,plan,evidence,resolver}.ts` |
| Qloo client/pacer/mock | `packages/qloo/src/` |
| Postgres repos/migrations | `packages/db/` |
| API routes | `apps/web/app/api/` — page, feedback, profile, settings, activity, chat, mcp |
| Shared server logic | `apps/web/lib/server/` — `page/{rank,identify,session,layout,schemas}.ts`, `resolution/cache.ts`, `auth/` |
| Website pages/components | `apps/web/app/`, `apps/web/components/` — follow `apps/web/AGENTS.md` (check `node_modules/next/dist/docs` first) |
| MCP tools | `packages/mcp/src/` + `apps/web/app/mcp/` |
| Demo page seeds for `/try` | `apps/web/lib/pages/` |
| e2e | `e2e/` — config, fixtures, specs |

## 6. Troubleshooting

- **`/api/feedback` 404 "no matched thing to rate":** the stored PageResult item lacks `type` — results saved before the type field was added carry no type; new results do.
- **Extension does nothing on a page:** check the toolbar state first — guards (scheme, never-run, skip/off, incognito, password/payment fields) and detection both silently pass. The page result, if any, is inspectable at `/why/<id>`.
- **Auth routes 404 locally:** WorkOS variables unset — expected; use `FOCAL_DEV_SESSION=1`.
- **`pnpm e2e` "another next dev server is already running":** a stray dev server holds `apps/web`; stop it (the error prints the PID).
