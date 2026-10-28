import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { addEntry } from "@focal-ai/core";
import { connect, createDb, migrate, type Db } from "@focal-ai/db";
import { __setDbForTests } from "@/lib/server/db";
import { DELETE, GET, POST } from "@/app/api/profile/route";
import { GET as exportGET } from "@/app/api/profile/export/route";

let viewerUserId = "";
vi.mock("@/lib/server/auth/viewer", () => ({
  currentViewer: async () =>
    viewerUserId ? { userId: viewerUserId, email: "viewer@example.com", persisted: viewerUserId !== "dev" } : null,
}));

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const del = (body: unknown) =>
  DELETE(new Request("http://localhost/api/profile", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const empty = { version: 2 as const, updatedAt: new Date().toISOString(), entries: [] };

describe("profile route without a database", () => {
  beforeAll(() => __setDbForTests(null));
  afterAll(() => __setDbForTests(undefined));

  it("401s without a viewer", async () => {
    viewerUserId = "";
    expect((await GET()).status).toBe(401);
    expect((await post({ action: "approve_rule", entry_id: "x" })).status).toBe(401);
  });

  it("serves an empty feed and 404s unknown targets", async () => {
    viewerUserId = "u1";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], activity: [] });
    expect((await post({ action: "approve_rule", entry_id: "nope" })).status).toBe(404);
    expect((await post({ action: "undo", event_id: "nope" })).status).toBe(404);
  });

  it("export: 401 signed out, a JSON download with the memory profile signed in", async () => {
    viewerUserId = "";
    expect((await exportGET()).status).toBe(401);
    viewerUserId = "u1";
    const res = await exportGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="focal-export.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      user: { id: "u1", email: "viewer@example.com" },
      profile: { version: 2, entries: [] },
      activity: [],
      sites: [],
    });
  });

  it("delete: 401 signed out, 400 without confirm, deleted with it", async () => {
    viewerUserId = "";
    expect((await del({ confirm: "delete" })).status).toBe(401);
    viewerUserId = "u1";
    expect((await del({})).status).toBe(400);
    expect((await del({ confirm: "nope" })).status).toBe(400);
    const res = await del({ confirm: "delete" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });

  it("set_strength and remove 404 without a matching entry", async () => {
    viewerUserId = "u1";
    expect((await post({ action: "set_strength", entry_id: "nope", strength: "love" })).status).toBe(404);
    expect((await post({ action: "remove", entry_id: "nope" })).status).toBe(404);
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("profile route in Postgres", () => {
  let db: Db;
  let userId: string;
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = url ? connect(url, { max: 1 }) : null;

  beforeAll(async () => {
    await admin!.unsafe(`CREATE SCHEMA ${schema}`);
    db = createDb(connect(url!, { schema, max: 2 }));
    await migrate(db.sql);
    __setDbForTests(db);
    userId = (await db.users.upsert("viewer@example.com")).id;
    viewerUserId = userId;
  });
  afterAll(async () => {
    viewerUserId = "";
    __setDbForTests(undefined);
    await db.close();
    await admin!.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin!.end();
  });

  it("approves a pending rule as manual and undoes an mcp write", async () => {
    const rule = addEntry(empty, { kind: "rule", qlooId: "urn:tag:chain", name: "chain", source: "mcp:chatgpt" }, "mcp:chatgpt");
    await db.profile.commit(userId, rule.event as never, 0);
    const add = addEntry(
      { ...empty, entries: [rule.event.after!] },
      { kind: "thing", qlooId: "Q-rin", name: "Rintaro", type: "urn:entity:place", strength: "love", source: "mcp:chatgpt" },
      "mcp:chatgpt",
    );
    await db.profile.commit(userId, add.event as never, 1);

    const approved = await post({ action: "approve_rule", entry_id: rule.event.entryId });
    expect(approved.status).toBe(200);
    const body = (await approved.json()) as { entries: { id: string; status?: string }[]; activity: { actor: string; action: string }[] };
    expect(body.entries.find((e) => e.id === rule.event.entryId)?.status).toBe("active");
    expect(body.activity[0]).toMatchObject({ actor: "manual", action: "approve" });
    expect((await post({ action: "approve_rule", entry_id: rule.event.entryId })).status).toBe(404);

    const undone = await post({ action: "undo", event_id: add.event.id });
    expect(undone.status).toBe(200);
    const after = (await undone.json()) as { entries: { name: string }[]; activity: { action: string; undoes?: string; actor: string }[] };
    expect(after.entries.some((e) => e.name === "Rintaro")).toBe(false);
    expect(after.activity[0]).toMatchObject({ action: "undo", actor: "manual", undoes: add.event.id });

    expect((await post({ action: "undo", event_id: add.event.id })).status).toBe(404);
    const [undoRecord] = await db.profile.activity(userId, { limit: 1 });
    expect((await post({ action: "undo", event_id: undoRecord!.id })).status).toBe(404);
  });

  it("export returns the persisted profile, activity and sites", async () => {
    const add = addEntry(empty, { kind: "thing", qlooId: "Q-exp", name: "Exportable", type: "urn:entity:place", strength: "like", source: "manual" }, "manual");
    const version = (await db.profile.load(userId)).version;
    await db.profile.commit(userId, add.event as never, version);
    await db.sites.set(userId, "reddit.com", "skip");

    const res = await exportGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string };
      profile: { version: number; entries: { name: string }[] };
      activity: { action: string }[];
      sites: { hostname: string; mode: string }[];
    };
    expect(body.user).toMatchObject({ id: userId, email: "viewer@example.com" });
    expect(body.profile.entries.some((e) => e.name === "Exportable")).toBe(true);
    expect(body.activity.length).toBeGreaterThan(0);
    expect(body.sites).toEqual([{ hostname: "reddit.com", mode: "skip" }]);
  });

  it("set_strength and remove edit entries as manual, undoable", async () => {
    const add = addEntry(empty, { kind: "thing", qlooId: "Q-edit", name: "Editable", type: "urn:entity:place", strength: "like", source: "manual" }, "manual");
    const version = (await db.profile.load(userId)).version;
    await db.profile.commit(userId, add.event as never, version);

    const changed = await post({ action: "set_strength", entry_id: add.event.entryId, strength: "love" });
    expect(changed.status).toBe(200);
    let body = (await changed.json()) as { entries: { id: string; strength?: string }[]; activity: { id: string; actor: string; action: string }[] };
    expect(body.entries.find((e) => e.id === add.event.entryId)?.strength).toBe("love");
    expect(body.activity[0]).toMatchObject({ actor: "manual", action: "change" });

    const removed = await post({ action: "remove", entry_id: add.event.entryId });
    expect(removed.status).toBe(200);
    body = (await removed.json()) as typeof body;
    expect(body.entries.some((e) => e.id === add.event.entryId)).toBe(false);
    expect(body.activity[0]).toMatchObject({ actor: "manual", action: "remove" });

    expect((await post({ action: "set_strength", entry_id: add.event.entryId, strength: "like" })).status).toBe(404);
    const undo = await post({ action: "undo", event_id: body.activity[0]!.id });
    expect(undo.status).toBe(200);
    const after = (await undo.json()) as typeof body;
    expect(after.entries.find((e) => e.id === add.event.entryId)?.strength).toBe("love");
  });

  it("delete removes the account and its rows", async () => {
    const victim = (await db.users.upsert("victim@example.com")).id;
    const add = addEntry(empty, { kind: "thing", qlooId: "Q-v", name: "Victim", type: "urn:entity:place", strength: "like", source: "manual" }, "manual");
    await db.profile.commit(victim, add.event as never, 0);
    const { token } = await db.extensionSessions.issue(victim);
    const prev = viewerUserId;
    viewerUserId = victim;
    try {
      const res = await del({ confirm: "delete" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true });
    } finally {
      viewerUserId = prev;
    }
    expect(await db.users.get(victim)).toBeNull();
    expect(await db.profile.load(victim).catch(() => null)).toBeNull();
    expect(await db.extensionSessions.resolve(token)).toBeNull();
  });

  it("409s on a stale profile version", async () => {
    const rule = addEntry(empty, { kind: "rule", qlooId: "urn:tag:y", name: "y", source: "mcp:claude" }, "mcp:claude");
    const version = (await db.profile.load(userId)).version;
    await db.profile.commit(userId, rule.event as never, version);
    const orig = db.profile.load;
    db.profile.load = async (u: string) => ({ ...(await orig(u)), version: version - 1 });
    const res = await post({ action: "approve_rule", entry_id: rule.event.entryId });
    db.profile.load = orig;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "CONFLICT", message: expect.stringContaining("reload") } });
  });
});
