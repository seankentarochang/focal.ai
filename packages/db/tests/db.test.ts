import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError, loadMigrations, migrate, type Db } from "../src";
import { DATABASE_URL, entry, freshDb } from "./helpers";

describe.skipIf(!DATABASE_URL)("packages/db against Postgres", () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await freshDb());
  });
  afterAll(async () => drop?.());

  describe("migrations", () => {
    it("apply from empty and are idempotent", async () => {
      expect(loadMigrations().map((m) => m.name)).toEqual(["0001_init.sql", "0002_extension_sessions.sql", "0003_activity_seq.sql", "0004_activity_seq_renumber.sql"]);
      expect(await migrate(db.sql)).toEqual([]);
      const tables = await db.sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY 1`;
      expect(tables.map((t) => t.table_name)).toEqual([
        "activity_events", "extension_sessions", "layouts", "page_results", "profile_entries", "resolution_cache", "schema_migrations", "site_settings", "users",
      ]);
    });
  });

  describe("users", () => {
    it("upserts by case-insensitive email and merges provider ids", async () => {
      const a = await db.users.upsert("Ana@Example.com", { google: "g1" });
      const b = await db.users.upsert("ana@example.com", { email: "ana@example.com" });
      expect(b.id).toBe(a.id);
      expect(b.authIds).toEqual({ google: "g1", email: "ana@example.com" });
      expect((await db.users.byEmail("ANA@example.com"))?.id).toBe(a.id);
    });
  });

  describe("profile + activity", () => {
    it("commits add / change / remove with attribution and bumps the version", async () => {
      const u = await db.users.upsert("p1@example.com");
      const e = entry({ name: "Rintaro" });
      const v1 = await db.profile.commit(u.id, { id: "a1", actor: "chat", action: "add", entryId: e.id, after: e, at: "2026-10-20T10:00:00.000Z" }, 0);
      expect(v1).toBe(1);
      const changed = { ...e, strength: "love" as const };
      await db.profile.commit(u.id, { id: "a2", actor: "mcp:claude", action: "change", entryId: e.id, before: e, after: changed, at: "2026-10-20T10:01:00.000Z" });
      let p = await db.profile.load(u.id);
      expect(p.version).toBe(2);
      expect(p.entries).toEqual([changed]);

      await db.profile.commit(u.id, { id: "a3", actor: "manual", action: "remove", entryId: e.id, before: changed, at: "2026-10-20T10:02:00.000Z" });
      p = await db.profile.load(u.id);
      expect(p.entries).toEqual([]);

      const log = await db.profile.activity(u.id);
      expect(log.map((x) => [x.id, x.actor, x.action])).toEqual([
        ["a3", "manual", "remove"],
        ["a2", "mcp:claude", "change"],
        ["a1", "chat", "add"],
      ]);
      expect(log[1]!.before).toEqual(e);
      expect(log[1]!.after).toEqual(changed);
    });

    it("rejects stale writers without changing anything", async () => {
      const u = await db.users.upsert("p2@example.com");
      const e = entry();
      await db.profile.commit(u.id, { id: "b1", actor: "chat", action: "add", entryId: e.id, after: e, at: "2026-10-20T10:00:00.000Z" }, 0);
      const e2 = entry();
      await expect(
        db.profile.commit(u.id, { id: "b2", actor: "mcp:x", action: "add", entryId: e2.id, after: e2, at: "2026-10-20T10:00:01.000Z" }, 0),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const p = await db.profile.load(u.id);
      expect(p.entries.map((x) => x.id)).toEqual([e.id]);
      expect(await db.profile.event(u.id, "b2")).toBeNull();
    });

    it("records undo links and refuses to undo twice", async () => {
      const u = await db.users.upsert("p3@example.com");
      const e = entry();
      await db.profile.commit(u.id, { id: "c1", actor: "chat", action: "add", entryId: e.id, after: e, at: "2026-10-20T10:00:00.000Z" });
      await db.profile.commit(u.id, { id: "c2", actor: "manual", action: "undo", entryId: e.id, before: e, undoes: "c1", at: "2026-10-20T10:01:00.000Z" });
      expect((await db.profile.event(u.id, "c1"))?.undoneBy).toBe("c2");
      expect((await db.profile.load(u.id)).entries).toEqual([]);
      await expect(
        db.profile.commit(u.id, { id: "c3", actor: "manual", action: "undo", entryId: e.id, after: e, undoes: "c1", at: "2026-10-20T10:02:00.000Z" }),
      ).rejects.toBeInstanceOf(DbError);
      expect((await db.profile.load(u.id)).entries).toEqual([]);
    });

    it("keeps rules pending until approved and enforces rule shape", async () => {
      const u = await db.users.upsert("p4@example.com");
      const rule = entry({ kind: "rule", qlooId: "urn:tag:chain", strength: "never", status: "pending", source: "mcp:claude" });
      await db.profile.commit(u.id, { id: "d1", actor: "mcp:claude", action: "add", entryId: rule.id, after: rule, at: "2026-10-20T10:00:00.000Z" });
      const active = { ...rule, status: "active" as const };
      await db.profile.commit(u.id, { id: "d2", actor: "manual", action: "approve", entryId: rule.id, before: rule, after: active, at: "2026-10-20T10:01:00.000Z" });
      const [row] = await db.sql`SELECT status FROM profile_entries WHERE id = ${rule.id}`;
      expect(row!.status).toBe("active");
      const bad = entry({ kind: "rule", strength: "never" });
      await expect(
        db.profile.commit(u.id, { id: "d3", actor: "chat", action: "add", entryId: bad.id, after: bad, at: "2026-10-20T10:02:00.000Z" }),
      ).rejects.toThrow();
    });

    it("never writes into another user's entry", async () => {
      const a = await db.users.upsert("own-a@example.com");
      const b = await db.users.upsert("own-b@example.com");
      const e = entry();
      await db.profile.commit(a.id, { id: "f1", actor: "chat", action: "add", entryId: e.id, after: e, at: "2026-10-20T10:00:00.000Z" });
      await expect(
        db.profile.commit(b.id, { id: "f2", actor: "chat", action: "change", entryId: e.id, after: { ...e, strength: "dislike" }, at: "2026-10-20T10:01:00.000Z" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await db.profile.load(a.id)).entries[0]!.strength).toBe("like");
    });

    it("exports everything and delete cascades", async () => {
      const u = await db.users.upsert("p5@example.com");
      const e = entry();
      await db.profile.commit(u.id, { id: "g1", actor: "chat", action: "add", entryId: e.id, after: e, at: "2026-10-20T10:00:00.000Z" });
      await db.sites.set(u.id, "Reddit.com", "skip");
      await db.pageResults.save({ id: "pr-del", userId: u.id, hostname: "yelp.com", status: "ranked", items: [], plan: null, meta: null });
      const { token } = await db.extensionSessions.issue(u.id);
      const dump = await db.profile.export(u.id);
      expect(dump.profile.entries).toEqual([e]);
      expect(dump.activity).toHaveLength(1);
      expect(dump.sites).toEqual([{ hostname: "reddit.com", mode: "skip" }]);
      expect(await db.users.delete(u.id)).toBe(true);
      expect(await db.extensionSessions.resolve(token)).toBeNull();
      const left = await db.sql`
        SELECT (SELECT count(*) FROM profile_entries WHERE user_id = ${u.id})::int
             + (SELECT count(*) FROM activity_events WHERE user_id = ${u.id})::int
             + (SELECT count(*) FROM site_settings WHERE user_id = ${u.id})::int
             + (SELECT count(*) FROM page_results WHERE user_id = ${u.id})::int
             + (SELECT count(*) FROM extension_sessions WHERE user_id = ${u.id})::int AS n`;
      expect(left[0]!.n).toBe(0);
    });
  });

  describe("site settings", () => {
    it("sets, overrides and removes per-host modes", async () => {
      const u = await db.users.upsert("s1@example.com");
      await db.sites.set(u.id, "yelp.com", "off");
      await db.sites.set(u.id, "yelp.com", "off");
      await db.sites.set(u.id, "reddit.com", "skip");
      expect(await db.sites.list(u.id)).toEqual([
        { hostname: "reddit.com", mode: "skip" },
        { hostname: "yelp.com", mode: "off" },
      ]);
      await db.sites.remove(u.id, "yelp.com");
      expect(await db.sites.list(u.id)).toHaveLength(1);
    });
  });

  describe("resolution cache", () => {
    it("batch-reads by (name, type, city) and upserts", async () => {
      await db.resolutions.put([
        { normalizedName: "rintaro", type: "urn:entity:place", city: "san francisco", entityId: "Q-r", status: "matched", entity: { name: "Rintaro" } },
        { normalizedName: "dune", type: "urn:entity:book", entityId: "Q-d", status: "matched" },
        { normalizedName: "nowhere", type: "urn:entity:place", city: "x", entityId: null, status: "unresolved" },
      ]);
      const got = await db.resolutions.getMany([
        { normalizedName: "rintaro", type: "urn:entity:place", city: "san francisco" },
        { normalizedName: "rintaro", type: "urn:entity:place", city: "brooklyn" },
        { normalizedName: "dune", type: "urn:entity:book" },
        { normalizedName: "nowhere", type: "urn:entity:place", city: "x" },
      ]);
      expect(got.map((r) => [r.normalizedName, r.city, r.entityId]).sort()).toEqual([
        ["dune", "", "Q-d"],
        ["nowhere", "x", null],
        ["rintaro", "san francisco", "Q-r"],
      ]);
      await db.resolutions.put([{ normalizedName: "dune", type: "urn:entity:book", entityId: "Q-d2", status: "matched" }]);
      expect((await db.resolutions.getMany([{ normalizedName: "dune", type: "urn:entity:book" }]))[0]!.entityId).toBe("Q-d2");
      expect(await db.resolutions.getMany([])).toEqual([]);
      expect(await db.resolutions.getMany([{ normalizedName: "dune", type: "urn:entity:book" }], -60_000)).toEqual([]);
    });
  });

  describe("page results", () => {
    it("is readable only by its owner until it expires", async () => {
      const u = await db.users.upsert("r1@example.com");
      const other = await db.users.upsert("r2@example.com");
      await db.pageResults.save({ id: "pr1", userId: u.id, hostname: "yelp.com", status: "ranked", items: [{ clientId: "c0" }], plan: { ops: [] }, meta: null });
      expect((await db.pageResults.get("pr1", u.id))?.items).toEqual([{ clientId: "c0" }]);
      expect(await db.pageResults.get("pr1", other.id)).toBeNull();
      await db.pageResults.save({ id: "pr2", userId: u.id, hostname: "yelp.com", status: "ranked", items: [], plan: null, meta: null }, -1000);
      expect(await db.pageResults.get("pr2", u.id)).toBeNull();
      expect(await db.pageResults.purgeExpired()).toBeGreaterThanOrEqual(1);
      const [n] = await db.sql`SELECT count(*)::int AS n FROM page_results WHERE id = 'pr2'`;
      expect(n!.n).toBe(0);
    });
  });

  describe("extension sessions", () => {
    it("issues opaque tokens, stores only a hash, resolves and revokes", async () => {
      const u = await db.users.upsert("x1@example.com");
      const { token, session } = await db.extensionSessions.issue(u.id);
      expect(token).toMatch(/^fx_[\w-]{40,}$/);
      const [row] = await db.sql`SELECT token_hash FROM extension_sessions WHERE id = ${session.id}`;
      expect(row!.token_hash).not.toContain(token);
      expect((await db.extensionSessions.resolve(token))?.userId).toBe(u.id);
      expect(await db.extensionSessions.resolve("fx_wrong")).toBeNull();
      expect(await db.extensionSessions.revoke(token)).toBe(true);
      expect(await db.extensionSessions.resolve(token)).toBeNull();
    });

    it("expired sessions don't resolve; revokeAll signs out every device", async () => {
      const u = await db.users.upsert("x2@example.com");
      const old = await db.extensionSessions.issue(u.id, -1000);
      expect(await db.extensionSessions.resolve(old.token)).toBeNull();
      const a = await db.extensionSessions.issue(u.id);
      const b = await db.extensionSessions.issue(u.id);
      expect(await db.extensionSessions.revokeAll(u.id)).toBe(3);
      expect(await db.extensionSessions.resolve(a.token)).toBeNull();
      expect(await db.extensionSessions.resolve(b.token)).toBeNull();
    });
  });
});
