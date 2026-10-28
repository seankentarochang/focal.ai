import { cardNames, expect, FIXTURES, test } from "../helpers";

const apiCalls = (api: string[], path: string) => api.filter((u) => u.includes(path)).length;

test.describe("eligibility guards", () => {
  test("a page with a password field sends no identify or rank request", async ({ focal }) => {
    const page = await focal.context.newPage();
    await page.goto("https://secure.yelp.test:8443/search?find_desc=restaurants&find_loc=San+Francisco");
    await page.waitForTimeout(4000);
    expect(apiCalls(focal.api, "/api/page/")).toBe(0);
    await page.close();
  });

  test("a never-run category host sends no identify or rank request", async ({ focal }) => {
    const page = await focal.context.newPage();
    await page.goto("https://bank.test:8443/accounts");
    await page.waitForTimeout(4000);
    expect(apiCalls(focal.api, "/api/page/")).toBe(0);
    await page.close();
  });
});

test.describe("detect → identify → rank → apply", () => {
  test("lifted cards move to the top with labels; the rest keep order", async ({ focal }) => {
    const page = await focal.context.newPage();
    await page.goto(`${FIXTURES}/search?find_desc=restaurants&find_loc=San+Francisco`);
    await page.locator('[data-focal="strip"]').waitFor({ timeout: 20000 });
    await expect(page.locator('[data-focal="strip-text"]')).toContainText("focal lifted");

    const names = await cardNames(page);
    // Only the lifted card moved — the rest keep their relative order.
    expect(names).toEqual(["Rintaro", "House of Prime Rib", "Zuni Café", "State Bird Provisions", "Che Fico"]);
    expect(await page.locator("button[data-focal-action='more']").count()).toBeGreaterThanOrEqual(1);
    expect(apiCalls(focal.api, "/api/page/identify")).toBe(1);
    expect(apiCalls(focal.api, "/api/page/rank")).toBe(1);
    await page.close();
  });

  test("Undo restores the original order", async ({ focal }) => {
    const page = await focal.context.newPage();
    await page.goto(`${FIXTURES}/search?find_desc=restaurants&find_loc=San+Francisco`);
    await page.locator('[data-focal="strip"]').waitFor({ timeout: 20000 });
    await page.locator('[data-focal="undo"]').click();
    await expect(page.locator('[data-focal="strip"]')).toHaveCount(0);
    // The FLIP animation slides the card back over ~700ms; poll until it lands.
    await expect
      .poll(() => cardNames(page), { timeout: 5000 })
      .toEqual(["House of Prime Rib", "Zuni Café", "Rintaro", "State Bird Provisions", "Che Fico"]);
    await page.close();
  });
});

test.describe("feedback", () => {
  test("'More like this' hits /api/feedback and shows Saved · Undo", async ({ focal }) => {
    const page = await focal.context.newPage();
    await page.goto(`${FIXTURES}/search?find_desc=restaurants&find_loc=San+Francisco`);
    await page.locator('[data-focal="strip"]').waitFor({ timeout: 20000 });
    // The lifted card carries the feedback buttons; CSS `order` lifted it, so
    // DOM position says nothing — find the card that has them.
    const lifted = await page
      .locator("#results > article", { has: page.locator("button[data-focal-action='more']") })
      .first()
      .elementHandle();
    await lifted!.screenshot({ path: "e2e/artifacts/feedback.png" });
    await page.locator("button[data-focal-action='more']").first().click();
    await expect
      .poll(() => apiCalls(focal.api, "/api/feedback"), { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);
    expect(focal.api.find((u) => u.includes("/api/feedback"))).toMatch(/^200 /);
    await expect(page.locator("text=Saved ·")).toBeVisible({ timeout: 15000 });
    // The click removes the feedback buttons — the handle keeps the card.
    await lifted!.screenshot({ path: "e2e/artifacts/feedback-saved.png" });
    await page.close();
  });
});

test.describe("layout learning", () => {
  test("a second visit to the same layout sends no identify request", async ({ focal }) => {
    const page = await focal.context.newPage();
    await page.goto(`${FIXTURES}/search?find_desc=restaurants&find_loc=San+Francisco`);
    await page.locator('[data-focal="strip"]').waitFor({ timeout: 20000 });
    expect(apiCalls(focal.api, "/api/page/identify")).toBe(1);

    const second = await focal.context.newPage();
    await second.goto(`${FIXTURES}/search?find_desc=restaurants&find_loc=San+Francisco`);
    await second.locator('[data-focal="strip"]').waitFor({ timeout: 20000 });
    expect(apiCalls(focal.api, "/api/page/identify")).toBe(1);
    expect(apiCalls(focal.api, "/api/page/rank")).toBe(2);
    await page.close();
    await second.close();
  });
});
