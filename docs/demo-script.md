# Demo script — focal.ai

Two cuts for a judge: the **90-second core loop** and the **3-minute path** that adds the agent and paste-any-list. UI labels are quoted exactly as they appear; every claim here is something the shipped Studio actually does.

## 90-second path (the core loop)

**Step 0 — Load.** Open the deployed URL (or `http://localhost:3000` locally). Look at the top-bar pill first.
- Say: "This is a directory page — the same list everyone sees. focal.ai re-renders it around my taste."
- Check: the pill should read "Qloo connected". If it reads "MOCK DATA", say so out loud: "this run uses labeled fixture data."

**Step 1 — Seed two tastes.** In the "Your taste" panel (left), type `Rintaro` in the search box, press Search, click **Add**. Repeat with `Fugazi`.
- Say: "One restaurant, one band — each resolved to a Qloo entity ID and stored in this browser only."

**Step 2 — Focus Tables.** On the "Tables" tab, click **Focus 12 results**.
- Say: "Resolution looks up each name, then one batched ranking call scores all twelve candidates against my two seeds."

**Step 3 — Read the ranked list.** Point at the "% match" badges; where a grounded reason exists it appears under the name (items without evidence show no reason rather than a fabricated one). Point at the "Sponsored" tags.
- Say: "Every badge is Qloo affinity — not a model guess — and the chains carry their sponsored tag."

**Step 4 — Diff.** Click **Diff** in the Original / Focal / Diff switcher. Point at the strip ("X of 12 moved · 2 collapsed · avg Y positions") and the delta arrows.
- Say: "The diff counts what moved and that the plan collapsed the two sponsored placements — before I ever trust the order."

**Step 5 — Inspector.** The right rail opens on **Inspector**. Point at "Qloo request" (path `/v2/insights` + params), "Result" (source `live`/`mock`, duration, unresolved), "Plan", "Evidence".
- Say: "This is exactly what we asked Qloo — key excluded — with the top grounded reasons. Nothing is a black box."

*90-second cut ends here.*

## 3-minute path (adds the agent + the judge's own list)

**Step 6 — Ask focal for a policy.** Switch the right rail to **Ask focal**. Click the **"Hide sponsored"** chip. Watch the tool timeline (tool names + durations), read "Proposed rules" and the preview summary.
- Say: "The agent ran deterministic tools and proposed rules — nothing changes until I approve it."
- Click **Apply to profile**. The page re-renders with the preview.
- Say: "Applied to my profile — and the original order stays one click away via Reset."

**Step 7 — Paste the judge's own list.** Click the **Paste** tab. Paste names from any site or their notes (one per line, up to 50). Pick a Type (e.g. Place), optionally a city, click **Use this list**.
- Say: "Any list — not just our demo directories. Same pipeline."

**Step 8 — Focus the pasted list.** Click **Focus N results**. Point at the status line: "N left in place".
- Say: "Whatever Qloo cannot identify is left exactly where it was and counted — we never guess."

**Step 9 — Discovery.** Back in **Ask focal**, click **"Find me something similar"**.
- Say: "The same grounded pipeline can suggest things I have never seen — with affinity attached, and no invented picks."

## What NOT to claim

- No arbitrary-site claims: the Studio ranks its three demo directories and lists you paste; live-site DOM rewriting (the browser extension) is roadmap, not shipped.
- No accuracy numbers, no "beats X", no benchmarks — none exist. The only percentages on screen are per-item Qloo affinity.
- Do not present mock data as live — if the pill says "MOCK DATA", say it is labeled fixture data.
- Do not claim an LLM is reasoning — the agent is deterministic today and needs no LLM key; every plan is validated before it renders.
- Do not claim the profile or the page leaves the browser — only entity names, city strings, IDs, and the profile JSON go to our server (then Qloo sees names/city/IDs).

## Pre-demo checklist

- [ ] Smoke script green against the demo base URL: `SMOKE_BASE_URL=https://<deploy> pnpm smoke` (`scripts/smoke-prod.ts`; exits 1 on any failure, warns instead of failing on mock-mode runs — a clean live run should print no mock warnings).
- [ ] Expected pill state decided: "Qloo connected" for live; if the key has not arrived, run mock knowingly and say "MOCK DATA" before the judge asks.
- [ ] `QLOO_API_KEY` configured in the hosting environment (health shows `hasQlooKey: true`).
- [ ] Browser zoom set (~110–125%) for screen share; one window; no stray tabs.
- [ ] Fallback if the venue network fails: run locally — `pnpm dev` with a key in `apps/web/.env.local` (live), or `QLOO_MOCK=1 pnpm dev` (mock, labeled).

## Q&A crib

**1. What breaks without Qloo?** The core: no entity resolution and no cross-domain affinity. The app still runs — unresolved items stay in place and are counted — but it cannot rank. Qloo is the taste graph; we do not substitute a fabricated one.

**2. Is this just an LLM?** No. Ranking is deterministic math on Qloo affinity; the agent is a deterministic tool runner that needs no LLM key, and every compiled plan is validated before it renders. An LLM is optional narration, never the source of scores.

**3. Why not Spotify/Netflix APIs?** They are single-domain silos — music only, video only — with no portable taste profile and no way to rank arbitrary candidate lists from elsewhere. Qloo's affinity spans cultural domains, which is what lets a band seed re-rank a hotel list.

**4. What about privacy?** The profile lives in this browser (localStorage), travels per request, and is discarded server-side — no database, no accounts, no taste data in logs. Only names, city strings, and IDs go upstream; page HTML never leaves. The MCP server is read-only and local-only.

**5. What is the extension story?** The Studio is the shipped surface; the same pipeline is exposed to external agents over MCP (6 read-only tools, stdio, local). The browser extension that applies the same decisions to live pages is the roadmap item — not a claim for today.
