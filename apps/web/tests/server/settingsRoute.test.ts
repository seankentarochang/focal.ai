import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { connect, createDb, migrate, type Db } from "@focal-ai/db";
import { __setDbForTests } from "@/lib/server/db";
import { GET, PUT } from "@/app/api/settings/route";

process.env.FOCAL_DEV_SESSION = "1";

let viewerUserId = "";
vi.mock("@/lib/server/auth/viewer", () => ({
  currentViewer: async () =>
    viewerUserId ? { userId: viewerUserId, email: "viewer@example.com", persisted: viewerUserId !== "dev" } : null,
}));

const get = () => GET(new Request("http://localhost/api/settings"));
const put = (body: unknown, headers: Record<string, string> = {}) =>
  PUT(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
const bearer = { authorization: "Bearer dev-token" };

describe("/api/settings without a database", () => {
  beforeAll(() => __setDbForTests(null));
  beforeEach(() => {
    viewerUserId = "u-settings";
  });

  it("401s signed out, then serves and replaces the site list", async () => {
    viewerUserId = "";
    expect((await get()).status).toBe(401);
    expect((await put({ sites: [] })).status).toBe(401);

    viewerUserId = "u-settings";
    expect(await (await get()).json()).toEqual({ sites: [] });

    const res = await put({
      sites: [
        { hostname: "reddit.com", mode: "skip" },
        { hostname: "news.ycombinator.com", mode: "off" },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sites: [
        { hostname: "reddit.com", mode: "skip" },
        { hostname: "news.ycombinator.com", mode: "off" },
      ],
    });
  });

  it("PUT replaces the full list, not merges", async () => {
    viewerUserId = "u-replace";
    await put({ sites: [{ hostname: "a.com", mode: "skip" }, { hostname: "b.com", mode: "off" }] });
    const res = await put({ sites: [{ hostname: "c.com", mode: "skip" }] });
    expect(await res.json()).toEqual({ sites: [{ hostname: "c.com", mode: "skip" }] });
  });

  it("rejects bad hostnames, bad modes and oversize lists", async () => {
    expect((await put({ sites: [{ hostname: "not a host!", mode: "skip" }] })).status).toBe(400);
    expect((await put({ sites: [{ hostname: "ok.com", mode: "weird" }] })).status).toBe(400);
    expect((await put({ sites: Array.from({ length: 501 }, (_, i) => ({ hostname: `s${i}.com`, mode: "skip" })) })).status).toBe(400);
  });

  it("accepts the extension bearer session", async () => {
    viewerUserId = ""; // no cookie — fall back to the bearer token
    const res = await put({ sites: [{ hostname: "bearer.com", mode: "off" }] }, bearer);
    expect(res.status).toBe(200);
    const body = (await (await GET(new Request("http://localhost/api/settings", { headers: bearer }))).json()) as {
      sites: { hostname: string }[];
    };
    expect(body.sites.map((s) => s.hostname)).toEqual(["bearer.com"]);
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("/api/settings in Postgres", () => {
  let db: Db;
  let sql: { end: () => Promise<void> };
  let userId: string;

  beforeAll(async () => {
    sql = connect(url!) as never;
    db = createDb(sql as never);
    await migrate(db.sql);
    __setDbForTests(db);
    userId = (await db.users.upsert(`${randomUUID()}@example.com`)).id;
  });

  afterAll(async () => {
    __setDbForTests(undefined);
    await sql.end();
  });

  it("persists and replaces rows in site_settings", async () => {
    viewerUserId = userId;
    await put({ sites: [{ hostname: "skip.me", mode: "skip" }, { hostname: "off.me", mode: "off" }] });
    const list = await db.sites.list(userId);
    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        { hostname: "skip.me", mode: "skip" },
        { hostname: "off.me", mode: "off" },
      ]),
    );
    await put({ sites: [{ hostname: "off.me", mode: "off" }] });
    expect(await db.sites.list(userId)).toEqual([{ hostname: "off.me", mode: "off" }]);
  });
});
