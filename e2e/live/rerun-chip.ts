/** One-off R12 check: a rerun (scroll-appended cards) shows no "focal is ranking…" chip. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { openDb } from "@focal-ai/db";

const here = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(here, "..", "..", "apps", "extension", "dist");

const db = openDb(process.env.DATABASE_URL!);
const user = await db.users.upsert("live-e2e@focal.test");
const { token } = await db.extensionSessions.issue(user.id);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "focal-rerun-")), {
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--no-first-run"],
  viewport: { width: 1366, height: 900 },
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await sw.evaluate(async (t: string) => {
  await chrome.storage.local.set({
    session: { token: t, email: "live-e2e@focal.test", savedAt: new Date().toISOString() },
    settings: { skipSites: [], siteOff: [], incognito: false },
  });
}, token);

const page = await context.newPage();
let rankingChipSeen = 0;
page.on("domcontentloaded", () => {});
const chipPoll = setInterval(async () => {
  const texts = await page.locator('[data-focal="chip"]').allTextContents().catch(() => [] as string[]);
  if (texts.some((t) => /is ranking/i.test(t))) rankingChipSeen += 1;
}, 500);

await page.goto("https://store.steampowered.com/search/?filter=topsellers", { waitUntil: "domcontentloaded", timeout: 45000 });
const strip = page.locator('[data-focal="strip"]');
await strip.waitFor({ timeout: 40000 }).catch(() => {});
const hadStrip = (await strip.count()) > 0;

// Scroll to append more cards -> triggers a rerun.
const before = await page.locator("a.search_result_row").count();
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(1600);
}
const after = await page.locator("a.search_result_row").count();
await page.waitForTimeout(8000); // let any rerun + chip surface
clearInterval(chipPoll);

console.log(JSON.stringify({ hadStrip, cardsBefore: before, cardsAfter: after, rankingChipSeen }));
await context.close();
await db.sql.end();
