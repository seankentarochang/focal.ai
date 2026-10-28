# Devpost submission — focal.ai

## 1. Project name + tagline

**focal.ai** — "Every site, sorted by your taste."

## 2. Elevator pitch

You tell a chat agent what you like. It builds your taste profile. Every list you visit after that shows what you care about most first, automatically. focal.ai is a Chromium extension plus a small web app: it detects the list on a page, identifies the items, scores them against your Qloo profile in one batched call, and lifts the clear matches to the top of the site's own order — labelled with why, undoable in one click, and teachable with "More like this" / "Not for me" buttons. The same profile is writable from ChatGPT and Claude over a hosted MCP endpoint.

## 3. What it does

- **Lift-only re-ranking on live sites.** The extension finds repeated sibling cards, identifies them, and moves clear matches to the top with a grounded label ("Top pick for you · because you like Fugazi"). Everything else keeps the site's original order — nothing is hidden and no DOM nodes are recreated.
- **Taste profile, yours.** Built through the website chat (free-tier LLM provider chain), through on-page feedback, or through ChatGPT/Claude. Viewable and editable on `/profile`; every write is attributed, listed on `/activity`, and undoable.
- **Privacy guards first.** Never-run categories (banking, health, government, sign-in), your skip list, and password/payment-field checks run locally before anything is extracted; blocked pages send nothing. Only bounded card snippets leave the page — never HTML, forms, or screenshots. Full account on `/privacy`.
- **Learned layouts + resolution cache.** After a first visit, the structure-only layout identifies the same page type locally with zero requests; entity resolutions are cached server-side so repeat items skip `/search` entirely.
- **On-page feedback.** "More like this" / "Not for me" write likes/dislikes through `/api/feedback`, sourced from the saved page result — never a client-supplied entity — and undoable.
- **MCP for ChatGPT and Claude.** Nine profile tools on `/mcp` with OAuth via WorkOS AuthKit; writes are attributed and rules stay pending until approved on `/profile`.
- **`/try` playground.** The same lift-only ranking on demo lists or a pasted list, no account or install needed; results are transient and mock mode is labelled.

## 4. How Qloo is used

- `GET /search` — resolves each identified item name (+type, +city hints) to a Qloo entity; unresolvable items stay in place.
- `GET /v2/insights` — one batched call per page: profile signal entities/tags as `signal.interests`, resolved candidates as `filter.results.entities`, `filter.location.query`, `feature.explainability=true`. The returned affinities drive the lift decision and the label reasons.
- `GET /v2/tags` / `GET /v2/entities` — signal selection and entity enrichment.
- A single process-wide 5 req/s pacer guards every call; resolutions are cached in Postgres so a repeated item never re-queries.

## 5. What makes it agentic

The profile is the agent surface: the website chat agent writes it through tool calls with attribution and undo; the hosted MCP endpoint gives ChatGPT and Claude the same nine tools over OAuth; and the extension turns each page visit into an implicit agent action — identify, rank, apply — plus explicit "More like this" / "Not for me" feedback that writes back into the same profile. Every agent write is an activity event, reversible from the page or `/activity`.

## 6. Why cultural intelligence matters

Cross-domain affinity is the product: a Fugazi seed and a Rintaro seed together lift a Lisbon hotel or a brand the user never searched for, because Qloo scores across cultural domains rather than within one catalog. Labels cite real explainability contributions only — never fabricated reasons.

## 7. Target user + impact

People with strong taste who read list-heavy sites — restaurants, films, hotels, books — where the default order is optimized for the site, not for them. One portable profile, seeded in a sentence or two, reorders every list to fit.

## 8. Tech stack + repo links

Next.js 16.4.2 (App Router, Turbopack), Chrome MV3 extension (TypeScript, esbuild), Postgres via `postgres` + typed repos, WorkOS AuthKit, Qloo Taste AI, TypeSafe Jev, MCP SDK, Playwright. pnpm monorepo: `apps/{web,extension}` + `packages/{core,qloo,db,mcp}` + `e2e/`. Tests: web 153, extension 73, core 120, qloo 63, db 14, mcp 24, e2e 6 — all offline except the Postgres-backed suites.

- Repo: `<URL — TBD>`
- Live demo: `<URL — TBD; not deployed yet (S-03)>`
- Extension: `<Web Store URL — TBD; install via CI zip until the listing lands>`

## 9. Known limitations

- **Chromium only** (MV3); no Firefox/Safari build.
- **Not deployed yet** — the hosted URL and the sign-in-to-ranked-page walkthrough need the AuthKit/Neon/Vercel steps in `docs/deployment.md`.
- **Web Store review pending** — `<all_urls>` triggers an in-depth review; the CI zip is the install path until it lands.
- **Mock mode is labelled** — offline runs use fixture data and say so; live needs Qloo and TypeSafe keys.
- **No sponsored detection** — lifts are taste-based only.
- **Chat needs one free LLM key** (Groq / Cerebras / OpenRouter).
