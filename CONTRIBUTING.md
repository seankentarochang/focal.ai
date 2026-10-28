# Contributing to focal.ai

Thanks for being here. focal.ai is early, so almost everything is still open.

## Where to start

The highest leverage contributions, in order:

1. **Detection and identification quality.** The generic sibling-card detector
   (`apps/extension/src/detect`) misses on some layouts, and learned layouts
   (`apps/web/lib/server/page/layout.ts`, `apps/extension/src/layouts/`) are
   only as good as the cards they were trained on. A failing site you use
   every day is the best possible bug report — include the page URL and a
   redacted copy of its list markup.
2. **The lift rule.** Tuning `decideLift` (`packages/core/src/lift.ts`) —
   thresholds, min-scored, top-pick rules — changes what every page feels
   like. Proposals need before/after evidence on real lists.
3. **MCP tools and website UX.** `packages/mcp` and `apps/web` — the profile,
   activity, settings and onboarding surfaces all have room to grow.
4. **Performance.** Identify and rank are the slow path. The resolution
   cache, the shared 5 req/s Qloo pacer and layout learning exist to keep
   them off it; regressions there are treated as bugs.

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local    # see README for the variables
cd apps/web && QLOO_MOCK=1 FOCAL_DEV_SESSION=1 pnpm dev   # web app, zero keys
cd apps/extension && FOCAL_ORIGIN=http://localhost:3000 pnpm build
```

The e2e harness needs a Postgres (`DATABASE_URL`); see `e2e/` for the fixture
server and spec layout.

## Before you open a PR

```bash
pnpm -r typecheck && pnpm -r test   # DB suites need DATABASE_URL
pnpm e2e                            # Playwright, fully offline
pnpm --filter @focal-ai/web build
pnpm --filter @focal-ai/extension build
```

Packages (`packages/{core,qloo,db,mcp}`) are consumed as TypeScript source —
there is no `dist` build step. `docs/tickets.md` is the work backlog.

- Keep PRs focused on one thing.
- Anything that changes what a page looks like needs a before/after.
- Anything that changes what leaves the browser needs a note in the PR
  describing exactly what is sent and why, and a matching `/privacy` update.

## Ground rules

- Page HTML, screenshots and form contents never leave the client. PRs that
  change this will be closed.
- Never-run categories (banking, health, government, sign-in, adult,
  gambling) stay blocked. This is not configurable.
- The lift rule only reorders. It never hides site content and never injects
  content the site did not already have.
- Every profile write stays attributed and reversible.

## Reporting bugs

Open an issue with the URL, what focal did, and what you expected. Security
issues should go to the maintainers privately rather than into a public
issue.
