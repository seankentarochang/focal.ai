import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, test as base } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

export const FIXTURES = "https://www.yelp.test:8443";
const EXT_DIR = join(here, "..", "apps", "extension", "dist");

export interface Focal {
  context: BrowserContext;
  /** Every extension service-worker request to the local web app, in order. */
  api: string[];
}

export const test = base.extend<{ focal: Focal }>({
  focal: async ({}, use) => {
    const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "focal-e2e-")), {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        `--host-resolver-rules=MAP * 127.0.0.1,EXCLUDE localhost`,
        "--ignore-certificate-errors",
        "--no-first-run",
      ],
    });
    try {
      const api: string[] = [];
      context.on("response", (res) => {
        if (res.url().includes("localhost:3100/api/")) api.push(`${res.status()} ${res.url()}`);
      });
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      const sessionFile = join(here, ".session.json");
      const session = existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, "utf8")) : { token: "e2e-token" };
      await sw.evaluate(async (token: string) => {
        await chrome.storage.local.set({
          session: { token, email: "e2e@focal.test", savedAt: new Date().toISOString() },
          settings: { skipSites: [], siteOff: [], incognito: false },
        });
      }, session.token);
      await use({ context, api });
    } finally {
      await context.close();
    }
  },
});

export { expect } from "@playwright/test";

export const cards = (page: import("@playwright/test").Page) => page.locator("#results > article");
export const cardNames = (page: import("@playwright/test").Page) => page.locator("#results > article h3").allTextContents();
