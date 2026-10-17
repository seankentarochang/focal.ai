# Contributing to focal.ai

Thanks for being here. focal.ai is early, so almost everything is still open.

## Where to start

The highest leverage contributions, in order:

1. **Render policies.** A policy for a site you use every day is worth more than almost any code change. Add it to `policies/` and open a PR with a before and after screenshot.
2. **Extraction adapters.** The generic DOM walker misses on some frameworks and layouts. If a site extracts badly, a targeted adapter in `packages/core` fixes it for everyone.
3. **MCP tools.** New tools in `packages/mcp` that make the taste graph more useful to agents.
4. **Bugs and performance.** The render path has a 40 ms budget. Regressions there are treated as bugs.

## Setup

```bash
pnpm install
cp .env.example .env   # add your Qloo key
pnpm dev               # extension with hot reload
```

Load `apps/extension/dist` as an unpacked extension at `chrome://extensions`.

## Before you open a PR

```bash
pnpm test
pnpm lint
pnpm typecheck
```

- Keep PRs focused on one thing.
- Include a before and after for anything that changes rendering.
- New policies need at least one extraction test fixture.
- Anything that touches what leaves the browser needs a note in the PR describing exactly what is sent and why.

## Ground rules

- Page HTML, screenshots, and form contents never leave the client. PRs that change this will be closed.
- Blocked origins (banking, health, government, auth) stay blocked. This is not configurable.
- Every MCP write stays attributable and reversible.

## Reporting bugs

Open an issue with the URL, the policy that was active, and the output of `⌥F` on the page. Security issues should go to the maintainers privately rather than into a public issue.
