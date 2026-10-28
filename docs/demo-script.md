# Demo script — focal.ai

The product is the extension plus the website. Two cuts: the **3-minute local demo** (runs with zero keys in mock mode — say so out loud) and the **90-second highlight**. Base URL: `<hosted URL — TBD (S-03)>` or `http://localhost:3000`.

## Pre-demo checklist

- [ ] Web app running (`QLOO_MOCK=1 FOCAL_DEV_SESSION=1 pnpm dev` for local; "Mock mode" badges will show — that's honest, name them).
- [ ] `DATABASE_URL` pointing at Postgres (feedback + settings need it).
- [ ] Extension built (`FOCAL_ORIGIN=<app origin> pnpm build`) and loaded unpacked.
- [ ] A real list page ready (a Yelp search, a Letterboxd list) — or the e2e fixture flow if the network is unreliable.

## 3-minute path

**Step 0 — Onboarding.** Sign in (or the dev session lands on `/onboarding`). Say: "An empty profile goes straight to onboarding — four steps."

**Step 1 — Chat a taste.** In the chat step, type: "I love Rintaro in the Mission and I'm a huge Fugazi fan." The agent resolves and saves both. Say: "Every write is an activity event — attributable and undoable."

**Step 2 — Sites to skip.** Add a hostname to the skip list. Say: "Settings are server-owned and sync to the extension — eligibility never needs the network."

**Step 3 — Connect.** The hand-off step issues the extension session. Say: "One token, scoped to profile + page routes."

**Step 4 — The lift.** Open the restaurant list page. Watch the strip appear: "focal lifted N matches for your taste" — Rintaro slides to the top with a label: "Top pick for you · because you like Fugazi". Say: "Only the match moved — everything else kept the site's order. DOM nodes are reordered, never recreated, so the site's handlers still work."

**Step 5 — Why + Undo.** Click **Why** in the strip → `/why/<id>` shows the stored evidence (results kept 24 h). Click **Undo** → original order returns. Say: "The plan is declarative — the server sends ops, never selectors or code."

**Step 6 — Teach it back.** On the lifted card, click **More like this** → "Saved · Undo". Say: "Feedback is written server-side from the saved page result — the page can't invent an entity." Click **Not for me** on another lifted card if present. Open `/activity`: the feedback events are there, attributed `page`, each with an Undo.

**Step 7 — MCP.** Open `/connect`. Say: "The same profile is writable from ChatGPT and Claude — nine tools over OAuth, `add_thing`, `propose_rule`, `rank_list` — writes show as `via chatgpt`/`via claude` in the same activity feed."

**Step 8 — /try.** Open `/try` signed out (incognito works). Paste a list, hit Focus — the same lift-only pipeline, no account, results transient. Say: "Same `/api/try/rank` shares the rank function with the extension path — a test proves identical plans."

## 90-second cut

Steps 4–6 only: list page → strip + label → Why → Undo → More like this → `/activity`. End on: "Every site, sorted by your taste."

## What NOT to claim

- No hidden/reordered-everything claims — the rule is lift-only; nothing is removed and nothing is injected.
- No sponsored detection — say so if asked.
- No live-site accuracy numbers — fixture/demo lists only until S-03 deploys and real sites are verified.
- Say "Mock mode" when the badge shows — never present fixtures as live Qloo data.
- The store listing is pending — install is the built zip, say so.

## Q&A crib

**1. What breaks without Qloo?** Ranking — nothing lifts. Detection, guards, layouts and the profile still work; unresolved items stay in place, counted.

**2. Does it read my pages?** Only bounded card snapshots (≤6 snippets × ≤80 chars, ≤4 link refs, ≤60 cards, ≤5 city hints) after local guards pass. Never HTML, forms, screenshots, or browsing history — `/privacy` documents the lot.

**3. Is the reordering destructive?** No — CSS `order` on flex containers, node moves otherwise; nodes are never recreated; Undo restores everything.

**4. Where does the profile live?** Postgres, owned by the signed-in user; export + delete in `/settings`; every write is an undoable activity event.
