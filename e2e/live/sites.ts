/**
 * L6: visit real sites with the real extension pointed at :3300.
 * Records per-site metrics per the live-test rubric and writes
 * e2e/artifacts/live/sites.json plus one screenshot per site.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { openDb } from "@focal-ai/db";

const here = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(here, "..", "..", "apps", "extension", "dist");
const ORIGIN = "http://localhost:3300";
const ART = join(here, "..", "artifacts", "live");
mkdirSync(ART, { recursive: true });

// Rebuild the extension against :3300.
execFileSync(process.execPath, ["build.mjs"], {
  cwd: join(EXT_DIR, ".."),
  env: { ...process.env, FOCAL_ORIGIN: ORIGIN },
  stdio: "inherit",
});

const db = openDb(process.env.DATABASE_URL!);
const user = await db.users.upsert("live-e2e@focal.test");
const { token } = await db.extensionSessions.issue(user.id);

// Onboarding try-now URLs for the seeded profile (place + movie + game types).
const SITES: { key: string; url: string }[] = [
  { key: "imdb-top250", url: "https://www.imdb.com/chart/top/" },
  { key: "goodreads-best", url: "https://www.goodreads.com/list/show/1.Best_Books_Ever" },
  { key: "steam-topsellers", url: "https://store.steampowered.com/search/?filter=topsellers" },
  { key: "yelp-sf", url: "https://www.yelp.com/search?find_desc=restaurants&find_loc=San+Francisco" },
];
try {
  const mod = await import("../../apps/web/lib/onboarding.ts");
  const links = (mod.tryNowLinks ?? mod.default?.tryNowLinks)?.([
    { type: "urn:entity:place" }, { type: "urn:entity:movie" }, { type: "urn:entity:videogame" },
  ]) as { url: string; label?: string }[] | undefined;
  for (const l of links ?? []) SITES.unshift({ key: `trynow-${new URL(l.url).hostname.replace(/\W/g, "")}`, url: l.url });
} catch (e) {
  console.log("tryNowLinks import failed:", String(e));
}

interface ApiHit { status: number; path: string; body?: unknown }
const calls: ApiHit[] = [];

const context: BrowserContext = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "focal-live-")), {
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--no-first-run"],
  viewport: { width: 1366, height: 900 },
});
context.on("response", async (res) => {
  const u = res.url();
  if (!u.startsWith(`${ORIGIN}/api/`)) return;
  const hit: ApiHit = { status: res.status(), path: u.slice(ORIGIN.length).split("?")[0]! };
  if (u.includes("/api/page/identify") || u.includes("/api/page/rank")) {
    try { hit.body = await res.json(); } catch { /* ignore */ }
  }
  calls.push(hit);
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await sw.evaluate(async (t: string) => {
  await chrome.storage.local.set({
    session: { token: t, email: "live-e2e@focal.test", savedAt: new Date().toISOString() },
    settings: { skipSites: [], siteOff: [], incognito: false },
  });
}, token);

const results: Record<string, unknown>[] = [];

async function visit(url: string, second = false): Promise<{ status: number; finalUrl: string; botWall: boolean; page: Page; msLabels: number | null; labels: number; undoOk: boolean | null; visualOrder?: string[] }> {
  const page = await context.newPage();
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { console.log("goto err", String(e).slice(0, 120)); return null; });
  const status = resp?.status() ?? 0;
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const botWall = /unusual traffic|are you a robot|verify you are|captcha|cloudflare|access denied|robot check/i.test(bodyText.slice(0, 4000));
  let msLabels: number | null = null;
  let labels = 0;
  let undoOk: boolean | null = null;
  let visualOrder: string[] | undefined;
  if (!botWall && status > 0 && status < 400) {
    const strip = page.locator('[data-focal="strip"]');
    const chip = page.locator('[data-focal="chip"]');
    // A late-offered plan sits behind an Apply chip — click it to exercise the path.
    if (await chip.waitFor({ timeout: 25000 }).then(() => true).catch(() => false)) {
      const applyBtn = chip.locator("button", { hasText: "Apply" });
      if (await applyBtn.count()) await applyBtn.click();
    }
    if (await strip.waitFor({ timeout: 30000 }).then(() => true).catch(() => false)) {
      msLabels = Date.now() - t0;
      labels = await page.locator('[data-focal="label"]').count();
      visualOrder = await page.locator("h3").evaluateAll((els) => els.slice(0, 6).map((e) => (e.textContent ?? "").trim()));
      const undo = strip.locator('button[data-focal="undo"], button:has-text("Undo")').first();
      if (await undo.count()) {
        await undo.click();
        undoOk = (await strip.count()) === 0;
      }
    }
  }
  return { status, finalUrl: page.url(), botWall, page, msLabels, labels, undoOk, visualOrder };
}

for (const site of SITES) {
  const mark = calls.length;
  const first = await visit(site.url);
  const mine = calls.slice(mark);
  const identifyHit = mine.find((c) => c.path === "/api/page/identify");
  const rankHit = mine.find((c) => c.path === "/api/page/rank");
  const idBody = identifyHit?.body as { isList?: boolean; pageType?: string; items?: unknown[]; layout?: unknown } | undefined;
  const rkBody = rankHit?.body as { resolvedCount?: number; plan?: { summary?: { lifted?: number } }; status?: string } | undefined;
  if (!first.botWall && first.status > 0 && first.status < 400) await first.page.screenshot({ path: join(ART, `${site.key}.png`), fullPage: false });
  // Second visit: identify should be skipped (local layout).
  const mark2 = calls.length;
  const second = await visit(site.url, true);
  const secondIdentify = calls.slice(mark2).some((c) => c.path === "/api/page/identify");
  await second.page.close().catch(() => {});
  await first.page.close().catch(() => {});
  const cardCount = (idBody?.items?.length ?? 0);
  const classification =
    first.botWall ? "BLOCKED" :
    cardCount >= 3 && idBody?.isList && (rkBody?.resolvedCount ?? 0) >= 1 && ((rkBody?.plan?.summary?.lifted ?? 0) === 0 || first.labels > 0) && (first.undoOk ?? true) ? "PASS" :
    first.status >= 400 || first.status === 0 || first.undoOk === false ? "FAIL" :
    cardCount > 0 || identifyHit ? "PARTIAL" : "FAIL";
  results.push({
    site: site.key, url: site.url, status: first.status, finalUrl: first.finalUrl, botWall: first.botWall,
    identifySent: !!identifyHit, identifyStatus: identifyHit?.status,
    isList: idBody?.isList ?? null, pageType: idBody?.pageType ?? null, items: cardCount, layoutReturned: !!idBody?.layout,
    rankStatus: rankHit?.status, resolvedCount: rkBody?.resolvedCount ?? null, lifted: rkBody?.plan?.summary?.lifted ?? null,
    labelsVisible: first.labels, msToLabels: first.msLabels, undoOk: first.undoOk, secondVisitIdentify: secondIdentify,
    classification,
  });
  console.log(site.key, "->", classification, JSON.stringify(results[results.length - 1]).slice(0, 400));
}

writeFileSync(join(ART, "sites.json"), JSON.stringify(results, null, 2));
await context.close();
await db.sql.end();
console.log("-> e2e/artifacts/live/sites.json");
