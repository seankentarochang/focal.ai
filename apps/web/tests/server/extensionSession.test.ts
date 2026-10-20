import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { connect, createDb, migrate, type Db } from "@focal-ai/db";
import { __setDbForTests } from "@/lib/server/db";
import { resolveSession } from "@/lib/server/page/session";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("extension sessions in Postgres", () => {
  let db: Db;
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = url ? connect(url, { max: 1 }) : null;

  beforeAll(async () => {
    await admin!.unsafe(`CREATE SCHEMA ${schema}`);
    db = createDb(connect(url!, { schema, max: 2 }));
    await migrate(db.sql);
    __setDbForTests(db);
  });
  afterAll(async () => {
    __setDbForTests(undefined);
    await db.close();
    await admin!.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin!.end();
  });

  const req = (token?: string) =>
    new Request("http://localhost/api/page/rank", { headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("resolves a token to the user's stored profile", async () => {
    const user = await db.users.upsert("ext@example.com", { workos: "user_1" });
    const entry = {
      id: "e1", kind: "thing" as const, qlooId: "Q1", name: "Fugazi", type: "urn:entity:artist",
      strength: "love" as const, source: "manual", createdAt: "2026-10-20T00:00:00.000Z",
    };
    await db.profile.commit(user.id, { id: "a1", actor: "manual", action: "add", entryId: "e1", after: entry, at: "2026-10-20T00:00:00.000Z" });
    const { token } = await db.extensionSessions.issue(user.id);
    const session = await resolveSession(req(token));
    expect(session?.userId).toBe(user.id);
    expect(session?.profile.entries).toEqual([entry]);
  });

  it("rejects unknown, missing and revoked tokens (no dev fallback when a DB is configured)", async () => {
    process.env.FOCAL_DEV_SESSION = "1";
    try {
      expect(await resolveSession(req("fx_unknown"))).toBeNull();
      expect(await resolveSession(req())).toBeNull();
      const user = await db.users.upsert("ext2@example.com");
      const { token } = await db.extensionSessions.issue(user.id);
      await db.extensionSessions.revoke(token);
      expect(await resolveSession(req(token))).toBeNull();
    } finally {
      delete process.env.FOCAL_DEV_SESSION;
    }
  });
});
