import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PageResultItem, ProfileEntry, ProfileV2 } from "@focal-ai/core";
import { safeReturnTo } from "@/lib/server/auth/returnTo";
import { __setDbForTests } from "@/lib/server/db";
import {
  __setPageResultStoreForTests,
  createMemoryPageResultStore,
  getPageResultStore,
  type StoredPageResult,
} from "@/lib/server/page/store";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";
import { tryNowLinks } from "@/lib/onboarding";
import { buildWhyView } from "@/lib/why";

process.env.QLOO_MOCK = "1";
process.env.FOCAL_DEV_SESSION = "1";

beforeAll(() => __setDbForTests(null));
beforeEach(() => {
  __resetRateLimitForTests();
  __setPageResultStoreForTests(createMemoryPageResultStore());
});

describe("safeReturnTo", () => {
  it("keeps same-origin paths", () => {
    expect(safeReturnTo("/why/abc")).toBe("/why/abc");
    expect(safeReturnTo("/chat?x=1")).toBe("/chat?x=1");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "evil", "/a\nb", null, undefined, ""]) {
      expect(safeReturnTo(bad)).toBe("/connect");
    }
    expect(safeReturnTo("/" + "a".repeat(600))).toBe("/connect");
  });
});

const item = (clientId: string, name: string, originalIndex: number, extra: Partial<PageResultItem> = {}): PageResultItem => ({
  clientId,
  name,
  originalIndex,
  status: "resolved",
  outcome: "kept",
  ...extra,
});

const row = (over: Partial<StoredPageResult> = {}): StoredPageResult => ({
  id: "r1",
  userId: "dev",
  hostname: "example.com",
  status: "ranked",
  items: [
    item("a", "Alpha", 0, { affinity: 0.41 }),
    item("b", "Bravo", 1, { status: "unresolved", outcome: "unscored" }),
    item("c", "Charlie", 2, {
      affinity: 0.93,
      outcome: "lifted",
      label: { badge: "top-pick", text: "Top pick for you · because you like Fugazi", reasonNames: ["Fugazi"] },
    }),
  ],
  plan: {
    id: "p",
    pageId: "x",
    createdAt: "2026-10-20T00:00:00.000Z",
    ops: [{ op: "reorder", containerId: "k", order: ["c", "a", "b"] }],
    summary: { moved: 1, collapsed: 0, unresolved: 1, avgMovement: 1 },
  },
  meta: {
    resolved: 2,
    unresolved: 1,
    signals: { entities: [{ id: "f", name: "Fugazi", strength: "love" }], tags: [], localBoosts: [] },
    stats: { scored: 2, mean: 0.67, sd: 0.26 },
    qlooRequest: { path: "/v2/insights", params: { "filter.type": "urn:entity:place" } },
    durationMs: 1600,
  },
  createdAt: "2026-10-20T00:00:00.000Z",
  expiresAt: "2026-10-21T00:00:00.000Z",
  ...over,
});

describe("buildWhyView", () => {
  it("lists items in the order the user saw, with movement and exact affinity", () => {
    const view = buildWhyView(row());
    expect(view.items.map((i) => i.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(view.items[0]).toMatchObject({ originalPosition: 3, finalPosition: 1, moved: 2, affinity: 0.93 });
    expect(view.items[1]).toMatchObject({ originalPosition: 1, finalPosition: 2, moved: -1 });
    expect(view.counts).toEqual({ lifted: 1, folded: 0, disliked: 0, resolved: 2, unresolved: 1 });
    expect(view.signals.entities.map((s) => s.name)).toEqual(["Fugazi"]);
    expect(view.qlooRequest?.path).toBe("/v2/insights");
    expect(view.durationMs).toBe(1600);
  });

  it("falls back to site order when there is no plan", () => {
    const view = buildWhyView(row({ status: "no_signals", plan: null, meta: {} }));
    expect(view.items.map((i) => i.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(view.items.every((i) => i.moved === 0)).toBe(true);
    expect(view.signals).toEqual({ entities: [], tags: [], localBoosts: [] });
    expect(view.stats.scored).toBe(2);
  });

  it("tolerates malformed stored data", () => {
    const view = buildWhyView(row({ items: "nope", plan: { ops: "bad" }, meta: null }));
    expect(view.items).toEqual([]);
  });

  it("renders a real ranked result from /api/page/rank", async () => {
    const { POST } = await import("@/app/api/page/rank/route");
    const names = ["Rintaro", "State Bird Provisions", "Zuni Café", "House of Prime Rib", "Che Fico"];
    const res = await POST(
      new Request("http://localhost/api/page/rank", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer dev-token" },
        body: JSON.stringify({
          host: "www.yelp.com",
          pathPattern: "/search",
          pageType: "place",
          items: names.map((name, i) => ({ clientId: `c${i}`, name, type: "place", city: "San Francisco" })),
        }),
      }),
    );
    expect(res.status).toBe(200);
    const { pageResultId } = (await res.json()) as { pageResultId: string };
    const stored = await getPageResultStore().get(pageResultId, "dev");
    expect(stored).not.toBeNull();
    const view = buildWhyView(stored!);
    expect(view.hostname).toBe("www.yelp.com");
    expect(view.items.map((i) => i.name).sort()).toEqual([...names].sort());
    expect(await getPageResultStore().get(pageResultId, "someone-else")).toBeNull();
  });
});

describe("GET /api/me", () => {
  it("reports the dev session locally without exposing tokens", async () => {
    const { GET } = await import("@/app/api/me/route");
    const body = await (await GET()).json();
    expect(body).toEqual({ signedIn: true, email: "dev@localhost" });
  });

  it("reports signed out when no session is available", async () => {
    process.env.FOCAL_DEV_SESSION = "0";
    try {
      const { GET } = await import("@/app/api/me/route");
      expect(await (await GET()).json()).toEqual({ signedIn: false });
    } finally {
      process.env.FOCAL_DEV_SESSION = "1";
    }
  });
});

describe("POST /api/try/rank (W-04)", () => {
  const post = (url: string, body: unknown, auth = true) =>
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: "Bearer dev-token" } : {}) },
      body: JSON.stringify(body),
    });

  const rankBody = {
    host: "yelp.com",
    pathPattern: "/search",
    pageType: "place",
    items: [
      { clientId: "c0", name: "Rintaro", type: "place", city: "San Francisco" },
      { clientId: "c1", name: "Kissaki", type: "place", city: "San Francisco" },
      { clientId: "c2", name: "Zuni Cafe", type: "place", city: "San Francisco" },
    ],
  };

  const devSeeds = (profile: ProfileV2) =>
    profile.entries
      .filter((e) => e.kind === "thing" && "qlooId" in e)
      .map((e) => ({
        entityId: (e as { qlooId: string }).qlooId,
        name: e.name,
        subtype: (e as { type: string }).type,
        strength: (e as { strength: "love" | "like" | "dislike" }).strength,
      }));

  it("produces the same plan as /api/page/rank for equivalent input", async () => {
    const { POST: pageRank } = await import("@/app/api/page/rank/route");
    const { POST: tryRank } = await import("@/app/api/try/rank/route");
    const { DEV_PROFILE } = await import("@/lib/server/page/session");

    const pageRes = await pageRank(post("/api/page/rank", rankBody));
    expect(pageRes.status).toBe(200);
    const page = (await pageRes.json()) as { status: string; plan: { ops: unknown; summary: unknown } };

    const tryRes = await tryRank(
      post("/api/try/rank", {
        pageType: "urn:entity:place",
        items: rankBody.items.map((i) => ({ name: i.name, city: i.city })),
        seeds: devSeeds(DEV_PROFILE),
      }),
    );
    expect(tryRes.status).toBe(200);
    const tryBody = (await tryRes.json()) as { status: string; plan: { ops: unknown; summary: unknown }; mock: boolean };

    expect(tryBody.status).toBe(page.status);
    expect(tryBody.plan?.ops).toEqual(page.plan?.ops);
    expect(tryBody.plan?.summary).toEqual(page.plan?.summary);
    expect(tryBody.mock).toBe(true);
  });

  it("needs no session but validates the body", async () => {
    const { POST: tryRank } = await import("@/app/api/try/rank/route");
    const bad = await tryRank(post("/api/try/rank", { pageType: "place", items: [] }, false));
    expect(bad.status).toBe(400);
    const unknown = await tryRank(post("/api/try/rank", { pageType: "alien", items: [{ name: "X" }] }, false));
    expect(unknown.status).toBe(400);
  });
});

describe("tryNowLinks (W-01)", () => {
  const entry = (type: string, name: string, strength: "love" | "like" | "dislike" = "like"): ProfileEntry =>
    ({ id: `e-${name}`, kind: "thing", qlooId: `q-${name}`, name, type, strength, source: "manual", createdAt: "t" }) as unknown as ProfileEntry;

  it("builds per-type links, using a liked destination as the city", () => {
    const links = tryNowLinks([
      entry("urn:entity:destination", "San Francisco"),
      entry("urn:entity:movie", "Parasite"),
    ]);
    expect(links).toEqual([
      { label: "Things to do in San Francisco on Yelp", url: "https://www.yelp.com/search?find_desc=things+to+do&find_loc=San%20Francisco" },
      { label: "Popular films on Letterboxd", url: "https://letterboxd.com/films/popular/" },
    ]);
  });

  it("omits the city when the profile has no destination", () => {
    const links = tryNowLinks([entry("urn:entity:place", "Rintaro"), entry("urn:entity:movie", "Parasite")]);
    expect(links[0]).toEqual({ label: "Restaurants on Yelp", url: "https://www.yelp.com/search?find_desc=restaurants" });
  });

  it("falls back to a generic link for an empty profile and dedupes types", () => {
    expect(tryNowLinks([])).toEqual([{ label: "Top movies on IMDb", url: "https://www.imdb.com/chart/top/" }]);
    const links = tryNowLinks([entry("urn:entity:book", "A"), entry("urn:entity:book", "B")]);
    expect(links).toHaveLength(1);
  });
});
