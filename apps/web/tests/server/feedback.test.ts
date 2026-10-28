import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { addEntry } from "@focal-ai/core";
import { connect, createDb, migrate, type Db } from "@focal-ai/db";
import { __setDbForTests } from "@/lib/server/db";
import { POST } from "@/app/api/feedback/route";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";

const url = process.env.DATABASE_URL;

const post = (body: unknown, token: string) =>
  POST(
    new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );

describe.skipIf(!url)("POST /api/feedback in Postgres", () => {
  let db: Db;
  let sql: { end: () => Promise<void> };
  let userId = "", token = "";
  let pageResultId = "";

  const setup = async () => {
    sql = connect(url!) as never;
    db = createDb(sql as never);
    await migrate(db.sql);
    __setDbForTests(db);
    userId = (await db.users.upsert(`${randomUUID()}@example.com`)).id;
    ({ token } = await db.extensionSessions.issue(userId));
    pageResultId = `pr-fb-${randomUUID().slice(0, 8)}`;
    await db.pageResults.save({
      id: pageResultId,
      userId,
      hostname: "yelp.com",
      status: "ranked",
      items: [
        { clientId: "c0", name: "Rintaro", type: "urn:entity:place", status: "resolved", entityId: "E-rintaro", entityName: "Rintaro" },
        { clientId: "c1", name: "Mystery", status: "unresolved" },
      ],
      plan: null,
      meta: null,
    });
  };

  const entries = () => db.profile.load(userId).then((p) => p.entries);

  beforeAll(setup);

  afterAll(async () => {
    __setDbForTests(undefined);
    await sql.end();
  });

  it("'more' writes a like thing attributed to page, undoable", async () => {
    __resetRateLimitForTests();
    const res = await post({ pageResultId, clientId: "c0", verdict: "more", entityId: "FORGED" }, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; entryId: string; eventId: string };
    expect(body.saved).toBe(true);

    const [entry] = await entries();
    // The stored entity came from the PageResult, not the client's forged id.
    expect(entry).toMatchObject({ kind: "thing", qlooId: "E-rintaro", name: "Rintaro", strength: "like", source: "page" });
    const [event] = await db.profile.activity(userId, { limit: 1 });
    expect(event).toMatchObject({ id: body.eventId, actor: "page", action: "add", entryId: entry!.id });
  });

  it("'less' changes an existing entry's strength instead of duplicating", async () => {
    const res = await post({ pageResultId, clientId: "c0", verdict: "less" }, token);
    expect(res.status).toBe(200);
    const all = await entries();
    expect(all).toHaveLength(1);
    expect(all[0]!.strength).toBe("dislike");
  });

  it("404s for a card with no resolved entity and a foreign result", async () => {
    expect((await post({ pageResultId, clientId: "c1", verdict: "more" }, token)).status).toBe(404);
    expect((await post({ pageResultId, clientId: "c9", verdict: "more" }, token)).status).toBe(404);
    const other = (await db.users.upsert(`${randomUUID()}@example.com`)).id;
    const { token: otherToken } = await db.extensionSessions.issue(other);
    expect((await post({ pageResultId, clientId: "c0", verdict: "more" }, otherToken)).status).toBe(404);
  });

  it("404s for an expired page result", async () => {
    const oldId = `pr-old-${randomUUID().slice(0, 8)}`;
    await db.pageResults.save({ id: oldId, userId, hostname: "yelp.com", status: "ranked", items: [], plan: null, meta: null });
    await db.sql`UPDATE page_results SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = ${oldId}`;
    expect((await post({ pageResultId: oldId, clientId: "c0", verdict: "more" }, token)).status).toBe(404);
  });

  it("undo reverses the write and only works for actor=page events", async () => {
    const res = await post({ pageResultId, clientId: "c0", verdict: "more" }, token);
    const { eventId } = (await res.json()) as { eventId: string };
    const undone = await post({ action: "undo", eventId }, token);
    expect(undone.status).toBe(200);
    // The earlier "less" test left the entry at dislike; undoing the change
    // restores that state rather than emptying the profile.
    const [entry] = await entries();
    expect(entry).toMatchObject({ qlooId: "E-rintaro", strength: "dislike" });

    // An event from a different actor (manual) is not undoable via feedback.
    const write = addEntry(
      { version: 2, updatedAt: new Date().toISOString(), entries: [] },
      { kind: "thing", qlooId: "E-manual", name: "Manual", type: "urn:entity:place", strength: "like", source: "manual" } as never,
      "manual",
    );
    const version = (await db.profile.load(userId)).version;
    await db.profile.commit(userId, write.event as never, version);
    expect((await post({ action: "undo", eventId: write.event.id }, token)).status).toBe(404);
  });

  it("401s signed out", async () => {
    expect((await post({ pageResultId, clientId: "c0", verdict: "more" }, "bogus")).status).toBe(401);
  });
});
