import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { checkEligibility } from "../src/guards/eligibility";
import { hasSensitiveField } from "../src/guards/fields";
import { matchNeverRun } from "../src/guards/neverRun";
import { DEFAULT_SETTINGS, hostMatches, normalizeHost, parseSettings, toggleSite } from "../src/settings";

const doc = (html: string) => new JSDOM(`<body>${html}</body>`).window.document;
const base = { settings: DEFAULT_SETTINGS, incognito: false };

describe("never-run list", () => {
  it.each([
    ["https://www.paypal.com/myaccount", "banking"],
    ["https://secure.chase.com/web/auth", "banking"],
    ["https://online.citizensbank.co.uk/", "banking"],
    ["https://mychart.example-health.org/", "health"],
    ["https://www.nhs.uk/conditions", "health"],
    ["https://www.usa.gov/", "government"],
    ["https://www.gov.uk/browse", "government"],
    ["https://service.gouv.fr/", "government"],
    ["https://mail.google.com/mail/u/0", "email"],
    ["https://web.whatsapp.com/", "messaging"],
    ["https://docs.google.com/document/d/x", "documents"],
    ["https://vault.bitwarden.com/", "passwords"],
    ["https://accounts.google.com/signin", "sign-in"],
    ["https://www.yelp.com/login", "sign-in"],
    ["https://shop.example.com/checkout/cart", "sign-in"],
  ])("%s → %s", (url, category) => {
    expect(matchNeverRun(new URL(url))).toBe(category);
  });

  it("blocks focal's own site", () => {
    expect(matchNeverRun(new URL("https://app.focal.ai/profile"), ["focal.ai"])).toBe("focal");
  });

  it.each([
    "https://www.yelp.com/search?find_desc=ramen",
    "https://www.goodreads.com/list/show/1",
    "https://www.imdb.com/chart/top",
    "https://open.spotify.com/playlist/abc",
    "https://www.tripadvisor.com/Restaurants-g60763",
  ])("allows %s", (url) => {
    expect(matchNeverRun(new URL(url))).toBeNull();
  });
});

describe("sensitive fields", () => {
  it("detects password inputs", () => {
    expect(hasSensitiveField(doc('<input type="password">'))).toBe(true);
  });
  it("ignores password inputs the user can't see", () => {
    expect(hasSensitiveField(doc('<div hidden><input type="password"></div>'))).toBe(false);
    expect(hasSensitiveField(doc('<form style="display:none"><input type="password"></form>'))).toBe(false);
  });
  it("detects payment autocomplete, names and frames", () => {
    expect(hasSensitiveField(doc('<input autocomplete="cc-number">'))).toBe(true);
    expect(hasSensitiveField(doc('<input name="cvc">'))).toBe(true);
    expect(hasSensitiveField(doc('<iframe src="https://js.stripe.com/v3/elements"></iframe>'))).toBe(true);
  });
  it("ignores search boxes", () => {
    expect(hasSensitiveField(doc('<input type="search" name="q"><input name="find_loc">'))).toBe(false);
  });
});

describe("checkEligibility", () => {
  it("allows a normal page", () => {
    expect(checkEligibility({ ...base, url: "https://www.yelp.com/search", document: doc("<p>hi</p>") })).toEqual({ eligible: true });
  });
  it("rejects non-http schemes and bad urls", () => {
    expect(checkEligibility({ ...base, url: "chrome://extensions" })).toMatchObject({ eligible: false, reason: { kind: "scheme" } });
    expect(checkEligibility({ ...base, url: "not a url" })).toMatchObject({ eligible: false, reason: { kind: "scheme" } });
  });
  it("respects the skip list including subdomains", () => {
    const settings = parseSettings({ skipSites: ["https://www.Reddit.com/"] });
    expect(checkEligibility({ ...base, settings, url: "https://old.reddit.com/r/books" })).toMatchObject({
      eligible: false,
      reason: { kind: "skipped", site: "reddit.com" },
    });
  });
  it("respects per-site off from the toolbar", () => {
    const settings = toggleSite(DEFAULT_SETTINGS, "www.yelp.com", false);
    expect(checkEligibility({ ...base, settings, url: "https://www.yelp.com/search" })).toMatchObject({
      eligible: false,
      reason: { kind: "site-off" },
    });
    const back = toggleSite(settings, "yelp.com", true);
    expect(checkEligibility({ ...base, settings: back, url: "https://www.yelp.com/search" }).eligible).toBe(true);
  });
  it("is off in incognito unless enabled", () => {
    expect(checkEligibility({ ...base, incognito: true, url: "https://www.yelp.com/" })).toMatchObject({ reason: { kind: "incognito" } });
    const settings = { ...DEFAULT_SETTINGS, incognito: true };
    expect(checkEligibility({ ...base, settings, incognito: true, url: "https://www.yelp.com/" }).eligible).toBe(true);
  });
  it("rejects pages with sensitive fields", () => {
    expect(checkEligibility({ ...base, url: "https://www.yelp.com/", document: doc('<input type="password">') })).toMatchObject({
      reason: { kind: "sensitive-field" },
    });
  });
  it("never-run beats everything", () => {
    expect(checkEligibility({ ...base, url: "https://mail.google.com/" })).toMatchObject({ reason: { kind: "never-run", category: "email" } });
  });
});

describe("settings helpers", () => {
  it("normalizes hosts", () => {
    expect(normalizeHost("HTTPS://WWW.Yelp.com:443/search?q=1")).toBe("yelp.com");
    expect(hostMatches("m.yelp.com", "yelp.com")).toBe(true);
    expect(hostMatches("notyelp.com", "yelp.com")).toBe(false);
  });
  it("parses junk safely", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ skipSites: ["a.com", 3, "A.com"], incognito: "yes" })).toEqual({ skipSites: ["a.com"], siteOff: [], incognito: false });
  });
});
