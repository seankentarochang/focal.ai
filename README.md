<div align="center">

<img src="docs/assets/logo.svg" width="92" alt="focal.ai logo" />

# focal.ai

### Every site, sorted by your taste.

You tell a chat agent what you like. It builds your taste profile. Every site you visit after that shows what you care about most first, automatically.

[![License: MIT](https://img.shields.io/badge/License-MIT-6E56CF.svg?style=flat-square)](LICENSE)
[![Powered by Qloo](https://img.shields.io/badge/taste%20graph-Qloo-black?style=flat-square)](https://qloo.com)
[![MCP](https://img.shields.io/badge/MCP-hosted-00A3A3?style=flat-square)](https://modelcontextprotocol.io)

[What it does](#what-it-does) · [How it works](#how-it-works) · [Local setup](#local-setup) · [Tests](#tests) · [Privacy](#privacy)

</div>

> [!NOTE]
> **focal.ai runs locally and in CI; the hosted deployment is pending (S-03).**
> Chrome Web Store review is pending, so the supported install path is the
> extension zip built by CI (`pnpm --filter @focal-ai/extension zip`).
> Hosted URL: set after deploy (S-03).

---

## What it does

focal.ai is a Chromium extension (MV3) plus a small web app. On any page that
shows a list — restaurants, films, hotels, books, brands — the extension finds
the list, identifies the items, scores them against your Qloo taste profile,
and lifts the clear matches to the top of the site's own order, with a label
saying why. Nothing is hidden and nothing is re-created: the rest of the list
keeps its original order, one click undoes the lift, and every label offers
"More like this" / "Not for me" to teach the profile back.

Your profile lives on the website, editable by you in `/profile`, teachable
through chat, through page feedback, and through ChatGPT or Claude over the
hosted MCP endpoint — every write attributed and undoable on `/activity`.

## How it works

```
guards → detect → identify → rank → apply
  │        │         │         │       │
  │        │         │         │       └─ lift-only reorder, labels,
  │        │         │         │          Undo strip, feedback buttons
  │        │         │         └─ /api/page/rank: resolve → insights →
  │        │         │            lift rule → declarative plan
  │        │         └─ learned layout? skip the identifier entirely
  │        │            (first visit: identify route, layout saved)
  │        └─ repeated sibling cards with title-like text (no uploads)
  └─ https + not never-run + no password/payment fields — all local,
     before anything is extracted or sent
```

- **Guards run first, locally.** Never-run categories (banking, health,
  government, sign-in, adult, gambling), your skip list, incognito preference,
  and password/payment-field checks all pass or the page sends nothing.
- **Detect** finds the dominant group of repeated sibling cards and snapshots
  at most 60 of them — ≤6 snippets of ≤80 chars each, ≤4 link hosts/paths.
- **Identify** maps cards to names/type/city. A learned layout (structure-only,
  saved per site after a first visit) answers locally with no server call;
  otherwise `/api/page/identify` answers via the TypeSafe Jev identifier (mock
  in dev) and returns the layout to learn.
- **Rank** (`/api/page/rank`) resolves item names to Qloo entities (a shared
  Postgres cache makes repeat lookups free), scores them with one insights
  call per page against your profile's signals, and applies the lift-only
  rule: clear matches move to the top with a grounded label ("Top pick for
  you · because you like Fugazi"); everything else stays put.
- **Apply** reorders with CSS `order` or node moves, never recreating nodes,
  so the site's own click handlers survive. A "focal lifted N for your taste"
  strip offers Undo and Why this order; lifted cards get the label plus the
  feedback buttons.
- **Feedback** (`/api/feedback`) writes "more" as a like and "less" as a
  dislike straight into the profile — server-side, from the saved page
  result, never trusting a client-supplied entity. Undo restores it.

## The website

| Page | What it is |
| --- | --- |
| `/` | Landing — what focal does, sign in, links to `/try` and `/connect` |
| `/try` | The playground — demo list tabs and paste-a-list, ranked with the same lift-only pipeline; no account needed, results transient, mock mode labelled |
| `/onboarding` | First-run flow: chat, sites to skip, install + connect the extension, "try it now" links from your profile |
| `/chat` | The chat agent — teach the profile by talking |
| `/profile` | Entries, pending rules (approve/reject), strength editing, remove |
| `/activity` | Every write — who made it (chat, mcp:\*, page, manual), what changed, undo |
| `/settings` | Skip/off sites (synced to the extension), export your data, delete account |
| `/connect` | ChatGPT / Claude MCP hand-off and extension connection |
| `/why/[id]` | The evidence behind any page result (kept 24 h) |
| `/privacy` | Exactly what data goes where, what is stored, and for how long |

## MCP for ChatGPT and Claude

The site hosts an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`
(WorkOS AuthKit OAuth) with nine profile tools — `read_profile`,
`taste_summary`, `search_entities`, `add_thing`, `add_vibe`, `propose_rule`,
`remove_entry`, `recommend`, `rank_list`. Add it from `/connect`; writes are
attributed (`via chatgpt`, `via claude`) and undoable. A local read-only
stdio variant lives in `packages/mcp` (`pnpm --filter @focal-ai/mcp start`).

## Local setup

Requires pnpm 12, Node 22+ and a Postgres 17 (the repo's docker compose or any
local instance; tests expect `postgres://focal:focal@localhost:5432/focal` or
set `DATABASE_URL`).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # see variable names below
```

`apps/web/.env.local` keys (all server-only, never shipped to the extension):

| Variable | Purpose |
| --- | --- |
| `QLOO_API_KEY`, `QLOO_API_BASE` | Qloo taste graph; `QLOO_MOCK=1` runs fully offline with fixture data |
| `TYPESAFE_API_KEY` | The Jev page identifier; unset falls back to the mock identifier |
| `GROQ_API_KEY` / `CEREBRAS_API_KEY` / `OPENROUTER_API_KEY` | Chat LLM providers; chat needs one free-tier key |
| `DATABASE_URL` | Postgres; unset runs the web app in a limited no-DB mode |
| `WORKOS_*` | AuthKit sign-in; `FOCAL_DEV_SESSION=1` skips auth in development |

```bash
# 1. Web app on :3000 (mock Qloo + dev session needs zero keys)
cd apps/web && QLOO_MOCK=1 FOCAL_DEV_SESSION=1 pnpm dev

# 2. Extension: build pointed at the local app, then load apps/extension/dist
#    unpacked at chrome://extensions (Developer mode on)
cd apps/extension && FOCAL_ORIGIN=http://localhost:3000 pnpm build

# 3. Zip for install/CI distribution
pnpm --filter @focal-ai/extension zip
```

Open `localhost:3000`, sign in (or use the dev session), chat a taste or two,
then visit a list page — or press **Try** first to see the lift without
installing anything.

## Tests

```bash
pnpm -r typecheck
pnpm -r test        # unit + integration; DB suites need DATABASE_URL
pnpm e2e            # Playwright: 6 specs, fully offline
```

Current counts: web 153, extension 73, core 120, qloo 63, db 14, mcp 24,
e2e 6. The e2e suite starts the web app and an HTTPS fixture server, loads the
built extension into real Chromium, and covers the guards, the
detect→identify→rank→apply round trip, undo, feedback, and layout learning.

## Privacy

The full account is on `/privacy`. Short version: eligibility is decided
locally before anything is extracted; only bounded card snippets (names and
short text, never pages, forms or screenshots) reach the focal server;
identification goes to TypeSafe Jev and item names to Qloo; chat goes to the
configured LLM provider. Page results are kept 24 h, learned layouts hold
structure only, and export + delete live in `/settings`. There is no passive
browsing-history tracking, and built-in never-run categories can't be
unblocked.

## Honest limitations

- **Chromium only.** MV3 + service-worker plumbing; no Firefox/Safari build.
- **Mock mode is labelled.** `QLOO_MOCK=1` shows a "Mock mode" badge; live
  identification needs a TypeSafe Jev key and live taste needs a Qloo key.
- **Chat needs an LLM key.** One of Groq / Cerebras / OpenRouter (free tier).
- **No sponsored detection.** Lifts are taste-based only; nothing detects or
  removes ads.
- **Store listing pending.** Web Store review for `<all_urls>` is in-depth;
  the CI zip is the install path until it lands.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The work backlog is
[docs/tickets.md](docs/tickets.md) and live status is
[docs/status.md](docs/status.md).

## License

[MIT](LICENSE)
