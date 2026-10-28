import { z } from "zod";
import { currentViewer } from "@/lib/server/auth/viewer";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { resolveSession } from "@/lib/server/page/session";
import type { SiteMode, SiteSetting } from "@focal-ai/db";

const MAX_SITES = 500;
const host = z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9.-]+$/);
const putSchema = z.object({
  sites: z.array(z.object({ hostname: host, mode: z.enum(["skip", "off", "on"]) })).max(MAX_SITES),
});

const memory = new Map<string, SiteSetting[]>();

/** Website cookie or extension bearer session; null when signed out. */
async function caller(req: Request): Promise<{ userId: string; persisted: boolean } | null> {
  const viewer = await currentViewer();
  if (viewer) return { userId: viewer.userId, persisted: viewer.persisted };
  const session = await resolveSession(req);
  return session ? { userId: session.userId, persisted: true } : null;
}

async function read(userId: string, persisted: boolean): Promise<SiteSetting[]> {
  const db = getDb();
  if (persisted && db) return db.sites.list(userId);
  return memory.get(userId) ?? [];
}

export async function GET(req: Request): Promise<Response> {
  const who = await caller(req);
  if (!who) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  return Response.json({ sites: await read(who.userId, who.persisted) });
}

/** Replaces the full site list (§4.2): skip / off / on per hostname. */
export async function PUT(req: Request): Promise<Response> {
  const who = await caller(req);
  if (!who) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = putSchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  const sites = parsed.data.sites;
  const db = getDb();
  if (who.persisted && db) {
    const existing = await db.sites.list(who.userId);
    const keep = new Set(sites.map((s) => s.hostname));
    for (const old of existing) if (!keep.has(old.hostname)) await db.sites.remove(who.userId, old.hostname);
    for (const site of sites) await db.sites.set(who.userId, site.hostname, site.mode as SiteMode);
  } else {
    memory.set(who.userId, sites);
  }
  return Response.json({ sites: await read(who.userId, who.persisted) });
}
