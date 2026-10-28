import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connect, createDb, DbError, migrate, type Db } from "@focal-ai/db";
import { addEntry, changeStrength, type ProfileV2 } from "@focal-ai/core";
import { caller } from "@/lib/server/auth/caller";
import { errorResponse } from "@/lib/server/errors";
import { __resetRateLimitForTests, checkRateLimit } from "@/lib/server/rateLimit";

const url = process.env.DATABASE_URL;
let db: Db | null = null;
let userId = "";
let sql: ReturnType<typeof connect> | null = null;

describe.skipIf(!url)("round2 server fixes", () => {
  beforeAll(async () => {
    sql = connect(url!);
    db = createDb(sql as never);
    await migrate(db.sql);
    const user = await db.users.upsert(`r2-${Date.now()}@focal.test`);
    userId = user.id;
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("bearer token wins over the dev viewer under FOCAL_DEV_SESSION", async () => {
    vi.stubEnv("FOCAL_DEV_SESSION", "1");
    try {
      const { token } = await db!.extensionSessions.issue(userId);
      const who = await caller(new Request("http://x/api/settings", { headers: { authorization: `Bearer ${token}` } }));
      expect(who?.via).toBe("bearer");
      expect(who?.userId).toBe(userId);
      expect(who?.userId).not.toBe("dev");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("commit refuses an undo that a later change supersedes", async () => {
    const p: ProfileV2 = { version: 2, updatedAt: new Date().toISOString(), entries: [] };
    const add = addEntry(p, { kind: "thing", qlooId: "E1", name: "Thing", type: "urn:entity:place", strength: "love", source: "manual" }, "manual");
    await db!.profile.commit(userId, add.event! as never);
    const change = changeStrength(add.profile, add.event!.entryId, "like", "manual");
    await db!.profile.commit(userId, change.event! as never);
    // A direct undo of the FIRST event must conflict — the change supersedes it.
    const undo = {
      id: crypto.randomUUID(),
      actor: "manual",
      action: "undo" as const,
      entryId: add.event!.entryId,
      before: add.profile.entries[0]!,
      undoes: add.event!.id,
      at: new Date().toISOString(),
    };
    await expect(db!.profile.commit(userId, undo as never)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("activity orders by seq following (at, id)", async () => {
    const rows = await db!.profile.activity(userId, {});
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const seqs = rows.map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
  });

  it("errorResponse maps DbError CONFLICT to 409", async () => {
    const res = errorResponse(new DbError("CONFLICT", "x"));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CONFLICT");
  });

  it("no-op addEntry and changeStrength return event null", () => {
    const p: ProfileV2 = { version: 2, updatedAt: "t", entries: [] };
    const add = addEntry(p, { kind: "thing", qlooId: "E2", name: "Same", type: "urn:entity:place", strength: "like", source: "manual" }, "manual");
    expect(add.event).not.toBeNull();
    const again = addEntry(add.profile, { kind: "thing", qlooId: "E2", name: "Same", type: "urn:entity:place", strength: "like", source: "manual" }, "manual");
    expect(again.event).toBeNull();
    const same = changeStrength(add.profile, add.event!.entryId, "like", "manual");
    expect(same.event).toBeNull();
  });

  it("rate-limit eviction never resets a live key below the cap", () => {
    __resetRateLimitForTests();
    for (let i = 0; i < 10005; i++) checkRateLimit(`filler-${i}`, { limit: 60, windowMs: 60000 });
    checkRateLimit("vip", { limit: 1, windowMs: 60000 });
    checkRateLimit("vip", { limit: 1, windowMs: 60000 }); // now limited
    checkRateLimit("extra-1", { limit: 60, windowMs: 60000 });
    checkRateLimit("extra-2", { limit: 60, windowMs: 60000 });
    // vip is recent; oldest-eviction removed early fillers, not vip.
    expect(checkRateLimit("vip", { limit: 1, windowMs: 60000 }).ok).toBe(false);
  });

  it("re-saving an identical thing through dbProfileStore writes no event and bumps no version", async () => {
    const { dbProfileStore } = await import("@/lib/server/chat/store");
    const store = dbProfileStore(db!, userId);
    const profile = await store.load();
    const w = addEntry({ version: 2, updatedAt: new Date().toISOString(), entries: profile.entries as never }, {
      kind: "thing", qlooId: "E-ROUND", name: "Round", type: "urn:entity:place", strength: "love", source: "manual",
    } as never, "manual");
    if (w.event) await store.commit(w.profile as never, w.event as never);
    const v1 = (await store.load()).version;
    const events1 = await db!.profile.activity(userId, {});
    // Re-save the identical entry — deep-equal must fire even though Postgres
    // jsonb reordered the entry's keys.
    const w2 = addEntry({ version: 2, updatedAt: new Date().toISOString(), entries: (await store.load()).entries as never }, {
      kind: "thing", qlooId: "E-ROUND", name: "Round", type: "urn:entity:place", strength: "love", source: "manual",
    } as never, "manual");
    expect(w2.event).toBeNull();
    if (w2.event) await store.commit(w2.profile as never, w2.event as never);
    const events2 = await db!.profile.activity(userId, {});
    expect(events2.length).toBe(events1.length);
    expect((await store.load()).version).toBe(v1);
  });

  it("concurrent sites.replace and sites.set stay consistent", async () => {
    const replace = db!.sites.replace(userId, [{ hostname: "a.com", mode: "skip" }]);
    const set = db!.sites.set(userId, "b.com", "off");
    await Promise.all([replace, set]);
    const list = await db!.sites.list(userId);
    const consistent =
      JSON.stringify(list) === JSON.stringify([{ hostname: "a.com", mode: "skip" }]) ||
      JSON.stringify(list) ===
        JSON.stringify([
          { hostname: "a.com", mode: "skip" },
          { hostname: "b.com", mode: "off" },
        ]);
    expect(consistent).toBe(true);
  });

  it("resolveMcpCaller rejects fx_ tokens; fx_ still works on REST", async () => {
    const { resolveMcpCaller } = await import("@/lib/server/mcp/auth");
    const { resolveSession } = await import("@/lib/server/page/session");
    const { token } = await db!.extensionSessions.issue(userId);
    const bearer = new Request("http://x/mcp", { headers: { authorization: `Bearer ${token}` } });
    expect(await resolveMcpCaller(bearer, db!)).toBe("invalid");
    // same token resolves fine on the REST surface
    expect((await resolveSession(bearer))?.userId).toBe(userId);
  });

  it("usersRepo.delete returns {wid} and null for a missing row", async () => {
    const u = await db!.users.upsert(`r7del-${Date.now()}@focal.test`);
    const r = await db!.users.delete(u.id);
    expect(r).toEqual({ wid: null });
    expect(await db!.users.delete(u.id)).toBeNull();
  });

  it("DELETE /api/profile with no user row returns 404", async () => {
    const { DELETE } = await import("@/app/api/profile/route");
    const viewer = await import("@/lib/server/auth/viewer");
    vi.spyOn(viewer, "currentViewer").mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000000", email: "x@y.z", persisted: true } as never);
    const res = await DELETE(new Request("http://x/api/profile", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "delete" }) }));
    expect(res.status).toBe(404);
    vi.restoreAllMocks();
  });
});
