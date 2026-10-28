# Deployment — focal.ai

> Status (2026-10-28): focal.ai is **not deployed anywhere yet**. This is the deployment plan plus the verification steps to run once the host and production keys exist. The `Dockerfile` and `scripts/smoke-prod.ts` are in the repo; nothing here claims a deployment happened. The hosted URL is set after deploy (S-03).

## 1. What gets deployed

| Component | Runs on | Notes |
| --- | --- | --- |
| Website + API + hosted MCP (`apps/web`) | Vercel (primary) or any Node 22+ container (fallback) | The only HTTP surface; holds all keys server-side |
| Postgres | Neon | Accounts, profiles, activity, site settings, page results, extension sessions, layouts, resolution cache — `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (migrations) |
| Extension | Chrome Web Store (pending review) | MV3 zip from `pnpm --filter @focal-ai/extension zip`; until the listing lands, users install the built zip. The extension itself is not "deployed" — only the origin baked at build time matters |
| Local MCP (`packages/mcp`) | User's machine, stdio | Dev variant only |

## 2. Vercel

1. Import the repo. Root Directory `apps/web` with **"Include files outside the Root Directory"** enabled — the app imports `@focal-ai/{core,qloo,db,mcp}` as workspace TypeScript source. If workspace resolution fails, use repo root + Build Command `pnpm --filter @focal-ai/web build`.
2. Node 22+ (`.nvmrc` pins 24); pnpm 12.4.2 comes from `packageManager`.
3. Set the environment variables below for Production, then deploy.

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Accounts, saved profiles, feedback, settings and `/mcp` need it; without it `/mcp` and `/api/extension/session` return 503 and the account routes return 401 |
| `DATABASE_URL_UNPOOLED` | For migrations | Neon direct connection |
| `QLOO_API_KEY`, `QLOO_API_BASE` | **Yes** | Live taste data. `QLOO_MOCK` must **not** be set in production |
| `TYPESAFE_API_KEY` | **Yes** | The Jev page identifier; without it identification falls back to the mock — unacceptable in prod |
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` (≥32 chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | **Yes** | AuthKit sign-in |
| `WORKOS_AUTHKIT_DOMAIN` | **Yes for MCP OAuth** | Issuer for `/mcp` access tokens; `fx_` extension tokens are REST-only — `/mcp` is OAuth-only (R7-7) |
| `FOCAL_PUBLIC_URL` | **Yes** | Canonical origin — MCP protected-resource metadata + `/why` links |
| `NEXT_PUBLIC_FOCAL_EXTENSION_ID` | **Yes** | The extension id that receives the session hand-off on `/connect` |
| `GROQ_API_KEY` / `CEREBRAS_API_KEY` / `OPENROUTER_API_KEY` | For chat | At least one; the provider chain fails over on 429/5xx |
| `ANTHROPIC_API_KEY` | No | Reserved; no code path reads it |

### Post-deploy verification

1. `curl https://<host>/api/health` → `{"ok":true,"hasQlooKey":true,"dataSource":"live"}`.
2. `SMOKE_BASE_URL=https://<host> pnpm smoke` — health, MCP discovery (protected-resource metadata names `<base>/mcp`, 401 challenge carries `resource_metadata`, authorization server advertises S256 + registration), secret hygiene; expected exit 0.
3. Sign in → empty profile routes to `/onboarding` → `/connect` hands a session to the extension → a real list page lifts.
4. MCP: ChatGPT `chatgpt.com/plugins` → custom MCP server `focal` → OAuth; claude.ai → Settings → Connectors → `https://<host>/mcp` → Connect.

## 3. WorkOS dashboard (AuthKit)

Connect → Configuration:

1. Enable **Client ID Metadata Documents** and **Dynamic Client Registration** — ChatGPT and claude.ai register as OAuth clients this way.
2. Add `https://<host>/mcp` as a **Resource Indicator** and make it default so access tokens carry `/mcp` in `aud`.
3. Clients discover OAuth via `/.well-known/oauth-protected-resource/mcp`.

## 4. Neon

1. Create the project; take the pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED`.
2. `DATABASE_URL=<unpooled> pnpm --filter @focal-ai/db migrate` — users, profiles, activity, site settings, page results, extension_sessions, layouts, resolutions.
3. Page results carry a 24 h expiry (`expires_at`); add a Neon cron or sweep if accumulation matters — today the reads filter on expiry.

## 5. Fallback: Docker

Repo-root `Dockerfile` builds the standalone web app (Node 24):

```bash
docker build -t focal-web .
docker run -p 3000:3000 --env-file apps/web/.env.production focal-web
```

Same env table and health check as Vercel. Without Docker: `pnpm --filter @focal-ai/web build && pnpm --filter @focal-ai/web start` on any Node 22+ host.

## 6. Operational notes

- **Rate limits** are in-process, per instance: page routes per bearer user; `/api/try/rank` and `/api/qloo/search` per IP; `/mcp` per IP before auth (120/min) and per user after; plus a per-caller budget of 90 uncached Qloo name lookups a minute inside the resolver (over-budget items stay unresolved). Fine at demo scale; a shared store only matters for multi-instance fairness.
- **No browsing history is stored.** `page_results` rows expire in 24 h; logs carry no taste data and no keys (`meta.qlooRequest` excludes the key, asserted in tests).
- **Extension builds** must set `FOCAL_ORIGIN=https://<host>` at build time — the Web Store zip should be built with the production origin.
