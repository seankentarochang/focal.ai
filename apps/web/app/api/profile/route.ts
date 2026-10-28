import { z } from "zod";
import { approveRule, changeStrength, removeEntry, ProfileError } from "@focal-ai/core";
import { DbError } from "@focal-ai/db";
import { currentViewer } from "@/lib/server/auth/viewer";
import { dbProfileStore, memoryProfileStore } from "@/lib/server/chat/store";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { workosGone } from "@/lib/server/auth/users";
import { checkRateLimit } from "@/lib/server/rateLimit";

const ACTIVITY_LIMIT = 50;

function limited(retryAfterMs: number): Response {
  return Response.json(
    { error: { code: "RATE_LIMIT", message: "Too many profile writes" } },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_rule"), entry_id: z.string().min(1) }),
  z.object({ action: z.literal("set_strength"), entry_id: z.string().min(1), strength: z.enum(["love", "like", "dislike"]) }),
  z.object({ action: z.literal("remove"), entry_id: z.string().min(1) }),
]);

const deleteSchema = z.object({ confirm: z.literal("delete") });

function notFound(message: string): Response {
  return Response.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
}

/** Entries for the signed-in user; the activity feed lives at /api/activity. */
async function state(userId: string, persisted: boolean): Promise<Response> {
  const db = getDb();
  const store = persisted && db ? dbProfileStore(db, userId) : memoryProfileStore(userId);
  const { entries } = await store.load();
  return Response.json({ entries });
}

export async function GET(): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  return state(viewer.userId, viewer.persisted);
}

export async function POST(req: Request): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`profile:${viewer.userId}`, { limit: 30, windowMs: 60000 });
  if (!limit.ok) return limited(limit.retryAfterMs);
  const db = getDb();
  const store = viewer.persisted && db ? dbProfileStore(db, viewer.userId) : memoryProfileStore(viewer.userId);
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  try {
    if (parsed.data.action === "approve_rule") {
      const entryId = parsed.data.entry_id;
      const profile = await store.load();
      const target = profile.entries.find((e) => e.id === entryId);
      if (!target || target.kind !== "rule" || target.status !== "pending") {
        return notFound("No pending rule with that id");
      }
      const write = approveRule(profile, target.id);
      if (write.event) await store.commit(write.profile, write.event);
    } else if (parsed.data.action === "set_strength") {
      const { entry_id, strength } = parsed.data;
      const profile = await store.load();
      const target = profile.entries.find((e) => e.id === entry_id);
      if (!target || target.kind === "rule") return notFound("No editable entry with that id");
      const write = changeStrength(profile, target.id, strength, "manual");
      if (write.event) await store.commit(write.profile, write.event);
    } else if (parsed.data.action === "remove") {
      const { entry_id } = parsed.data;
      const profile = await store.load();
      const target = profile.entries.find((e) => e.id === entry_id);
      if (!target) return notFound("No entry with that id");
      const write = removeEntry(profile, target.id, "manual");
      if (write.event) await store.commit(write.profile, write.event);
    }
  } catch (e) {
    if (e instanceof DbError && e.code === "CONFLICT") {
      return Response.json(
        { error: { code: "CONFLICT", message: "Your profile changed elsewhere; reload and try again." } },
        { status: 409 },
      );
    }
    if (e instanceof DbError) return errorResponse(e);
    if (e instanceof ProfileError) return notFound(e.message);
    throw e;
  }
  return state(viewer.userId, viewer.persisted);
}

/** Delete the account (§6). Everything owned cascades with the users row. */
export async function DELETE(req: Request): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`profile-delete:${viewer.userId}`, { limit: 3, windowMs: 60000 });
  if (!limit.ok) return limited(limit.retryAfterMs);
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: 'send { "confirm": "delete" } to delete the account' } },
      { status: 400 },
    );
  }
  const db = getDb();
  if (viewer.persisted && db) {
    const row = await db.sql`SELECT auth_ids->>'workos' AS wid FROM users WHERE id = ${viewer.userId}`;
    // Local data first: its cascade is atomic, and a later sign-in creates an
    // empty account the retry path can finish — never leave data behind with
    // a live identity the user believes is gone (R5-11).
    await db.users.delete(viewer.userId);
    if (process.env.WORKOS_API_KEY && row[0]?.wid) {
      const { WorkOS } = await import("@workos-inc/node");
      try {
        await new WorkOS(process.env.WORKOS_API_KEY).userManagement.deleteUser(row[0].wid as string);
      } catch (e) {
        if (!workosGone(e)) {
          return Response.json(
            { error: { code: "IDENTITY_DELETE_FAILED", message: "Your data was deleted, but removing your sign-in failed. Try again." } },
            { status: 502 },
          );
        }
      }
    }
  }
  return Response.json({ deleted: true });
}
