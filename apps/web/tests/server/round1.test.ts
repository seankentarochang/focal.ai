import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, createDb, migrate, type Db } from "@focal-ai/db";
import { addEntry, changeStrength, type ProfileV2 } from "@focal-ai/core";
import { __setDbForTests } from "@/lib/server/db";
import { POST as undoPOST } from "@/app/api/activity/[id]/undo/route";
import { POST as feedbackPOST } from "@/app/api/feedback/route";
import { POST as settingsPOST, PUT as settingsPUT } from "@/app/api/settings/route";
import { POST as tryRankPOST } from "@/app/api/try/rank/route";
import { POST as pageRankPOST } from "@/app/api/page/rank/route";
import { ensureUser } from "@/lib/server/auth/users";
import { getResolutionStore } from "@/lib/server/resolution/cache";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";

process.env.FOCAL_DEV_SESSION = "1";
process.env.QLOO_MOCK = "1";

let viewerUserId = "";
vi.mock("@/lib/server/auth/viewer", () => ({
  currentViewer: async () =>
    viewerUserId ? { userId: viewerUserId, email: "v@x.com", persisted: viewerUserId !== "dev" } : null,
}));

const url = process.env.DATABASE_URL;
const dbify = !!url;
let db: Db;
let sql: ReturnType<typeof connect>;
let userId = "";
let token = "";

const post = (u: string, body: unknown, bearer?: string) =>
  new Request(`http://localhost${u}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
const undo = (id: string, bearer?: string) =>
  undoPOST(new Request(`http://localhost/api/activity/${id}/undo`, { method: "POST", headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }), {
    params: Promise.resolve({ id }),
  });

async function writeEntry(name: string, strength: "love" | "like" = "love") {
  const profile = await db.profile.load(userId);
  const v2 = { version: 2 as const, updatedAt: new Date().toISOString(), entries: profile.entries as never };
  const w = addEntry(v2, {
    kind: "thing", qlooId: crypto.randomUUID(), name, type: "urn:entity:place", strength, source: "manual",
  } as never, "manual");
  await db.profile.commit(userId, w.event as never, profile.version);
  return w;
}

beforeAll(async () => {
  if (!dbify) return;
  sql = connect(url!);
  db = createDb(sql as never);
  await migrate(db.sql);
  const u = await db.users.upsert(`round1-${crypto.randomUUID().slice(0,8)}@focal.test`);
  userId = u.id;
  ({ token } = await db.extensionSessions.issue(userId));
  __setDbForTests(db as never);
});
beforeEach(() => {
  viewerUserId = "";
  __resetRateLimitForTests();
});
afterAll(async () => {
  __setDbForTests(undefined as never);
  await sql?.end();
});

describe("POST /api/activity/[id]/undo", () => {
  it.skipIf(!dbify)("cookie caller undoes a manual event; bearer gets 404 on it", async () => {
    const w = await writeEntry("Undo Me Cafe");
    const bad = await undo(w.event!.id, token);
    expect(bad.status).toBe(404);
    viewerUserId = userId;
    const ok = await undo(w.event!.id);
    expect(ok.status).toBe(200);
    expect((await ok.json()).undone).toBe(true);
  });

  it.skipIf(!dbify)("bearer undoes a page event, and a double undo 404s", async () => {
    const result = await db.pageResults.save(
      {
        id: `pr-${crypto.randomUUID().slice(0,8)}`, userId, hostname: "yelp.com", status: "ranked",
        items: [{ clientId: "c0", name: "Rintaro", type: "urn:entity:place", status: "resolved", entityId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01", entityName: "Rintaro" }],
        plan: null, meta: {},
      },
      86400000,
    );
    const fb = await feedbackPOST(post("/api/feedback", { pageResultId: result.id, clientId: "c0", verdict: "more" }, token));
    expect(fb.status).toBe(200);
    const { eventId } = await fb.json();
    expect((await undo(eventId, token)).status).toBe(200);
    expect((await undo(eventId, token)).status).toBe(404); // already undone
  });

  it.skipIf(!dbify)("409s when a later not-undone event touched the entry", async () => {
    const w = await writeEntry("Later Change Bistro");
    const entryId = w.event!.entryId;
    const p2 = await db.profile.load(userId);
    const w2 = changeStrength({ version: 2 as const, updatedAt: new Date().toISOString(), entries: p2.entries as never }, entryId, "like", "manual");
    await db.profile.commit(userId, w2.event as never, p2.version);
    viewerUserId = userId;
    const res = await undo(w.event!.id);
    expect(res.status).toBe(409);
  });
});

describe("/api/feedback round-1 semantics", () => {
  const saveResult = (id: string, status = "resolved") =>
    db.pageResults.save(
      {
        id, userId, hostname: "yelp.com", status: "ranked",
        items: [{ clientId: "c0", name: "Rintaro", type: "urn:entity:place", status, entityId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01", entityName: "Rintaro" }],
        plan: null, meta: {},
      },
      86400000,
    );

  it.skipIf(!dbify)("same strength returns eventId:null and writes no event", async () => {
    const id = `pr-${crypto.randomUUID().slice(0,8)}`; await saveResult(id);
    const once = await feedbackPOST(post("/api/feedback", { pageResultId: id, clientId: "c0", verdict: "more" }, token));
    expect(once.status).toBe(200);
    const eventsBefore = (await db.profile.activity(userId, { limit: 100 })).length;
    const twice = await feedbackPOST(post("/api/feedback", { pageResultId: id, clientId: "c0", verdict: "more" }, token));
    expect(twice.status).toBe(200);
    expect((await twice.json()).eventId).toBeNull();
    expect((await db.profile.activity(userId, { limit: 100 })).length).toBe(eventsBefore);
  });

  it.skipIf(!dbify)("rejects a non-resolved item", async () => {
    const id = `pr-${crypto.randomUUID().slice(0,8)}`; await saveResult(id, "ambiguous");
    const res = await feedbackPOST(post("/api/feedback", { pageResultId: id, clientId: "c0", verdict: "more" }, token));
    expect(res.status).toBe(404);
  });
});

describe("/api/settings POST single-site", () => {
  it.skipIf(!dbify)("sets a site and removes it with mode:null", async () => {
    viewerUserId = userId;
    const set = await settingsPOST(post("/api/settings", { hostname: "example.com", mode: "skip" }));
    expect(set.status).toBe(200);
    expect((await db.sites.list(userId)).some((s) => s.hostname === "example.com" && s.mode === "skip")).toBe(true);
    const del = await settingsPOST(post("/api/settings", { hostname: "example.com", mode: null }));
    expect(del.status).toBe(200);
    expect((await db.sites.list(userId)).some((s) => s.hostname === "example.com")).toBe(false);
  });
});

describe("ensureUser merge rules", () => {
  it.skipIf(!dbify)("refuses to merge an unverified email", async () => {
    const email = "unverified-merge@focal.test";
    const first = await db.users.upsert(email, { workos: "wos_first" });
    await expect(ensureUser(db, { id: "wos_other", email, emailVerified: false })).rejects.toThrow();
    const still = await db.users.byEmail(email);
    expect(still!.id).toBe(first.id);
    expect(await db.users.byAuthId("workos", "wos_other")).toBeNull();
    // verified email claims the account
    const claimed = await ensureUser(db, { id: "wos_other", email, emailVerified: true });
    expect(claimed.id).toBe(first.id);
  });
});

describe("/api/page/rank resolvedCount", () => {
  it.skipIf(!dbify)("returns resolvedCount", async () => {
    const res = await pageRankPOST(
      post("/api/page/rank", {
        host: "www.yelp.test", pathPattern: "/search", pageType: "place",
        items: [
          { clientId: "c0", name: "Rintaro", type: "place", city: "San Francisco" },
          { clientId: "c1", name: "State Bird Provisions", type: "place", city: "San Francisco" },
        ],
      }, token),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.resolvedCount).toBe("number");
  });
});

describe("mock mode skips the resolution cache", () => {
  it("getResolutionStore is null with QLOO_MOCK=1", () => {
    expect(process.env.QLOO_MOCK).toBe("1");
    expect(getResolutionStore()).toBeNull();
  });
});

describe("activity seq ordering and pagination", () => {
  it.skipIf(!dbify)("orders by seq and pages on before=<seq>", async () => {
    for (let i = 0; i < 3; i++) await writeEntry(`Seq Place ${i}`);
    const feed = await db.profile.activity(userId, { limit: 100 });
    const seqs = feed.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    const cursor = feed[1].seq;
    const older = await db.profile.activity(userId, { limit: 100, before: cursor });
    expect(older.every((e) => e.seq < cursor)).toBe(true);
    expect(older.length).toBe(feed.length - 2); // feed[0] and feed[1] are >= cursor
  });
});

describe("/api/try/rank clientIds and meta", () => {
  it("echoes clientIds and returns meta fields", async () => {
    const res = await tryRankPOST(
      post("/api/try/rank", {
        pageType: "urn:entity:place",
        items: [
          { clientId: "my-a", name: "Rintaro", city: "San Francisco" },
          { clientId: "my-b", name: "Zuni Café", city: "San Francisco" },
          { clientId: "my-c", name: "House of Prime Rib", city: "San Francisco" },
        ],
        seeds: [],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { clientId: string }) => i.clientId)).toContain("my-b");
    expect(body.meta.durationMs).toBeTypeOf("number");
    expect(body.meta.unresolved).toBeTypeOf("number");
    expect(body.meta.dataSource).toBe("mock");
  });
});

describe("R7-1 searchBodySchema", () => {
  it("rejects an unknown entity type with no upstream call", async () => {
    const { searchBodySchema } = await import("@/lib/server/schemas");
    const bad = searchBodySchema.safeParse({ query: "pizza", types: ["not-a-urn"] });
    expect(bad.success).toBe(false);
    const ok = searchBodySchema.safeParse({ query: "pizza", types: ["urn:entity:place"], location: " Austin ".repeat(20) });
    expect(ok.success).toBe(false); // location capped at 80
    const ok2 = searchBodySchema.safeParse({ query: "pizza", types: ["urn:entity:place"], location: "Austin" });
    expect(ok2.success).toBe(true);
  });
});
