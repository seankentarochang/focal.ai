import { z } from "zod";
import { caller } from "@/lib/server/auth/caller";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { checkRateLimit } from "@/lib/server/rateLimit";
import type { SiteMode, SiteSetting } from "@focal-ai/db";
import { memorySites, setMemorySites } from "@/lib/server/sites/store";

const MAX_SITES = 500;
const host = z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9.-]+$/);
const putSchema = z.object({
  sites: z.array(z.object({ hostname: host, mode: z.enum(["skip", "off"]) })).max(MAX_SITES),
});


const RATE_LIMIT = { limit: 30, windowMs: 60000 };

function limited(retryAfterMs: number): Response {
  return Response.json(
    { error: { code: "RATE_LIMIT", message: "Too many settings writes" } },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

async function read(userId: string, persisted: boolean): Promise<SiteSetting[]> {
  const db = getDb();
  if (persisted && db) return db.sites.list(userId);
  return memorySites(userId);
}

export async function GET(req: Request): Promise<Response> {
  const who = await caller(req);
  if (!who) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  return Response.json({ sites: await read(who.userId, who.persisted) });
}

/** Replaces the full site list (§4.2): skip / off per hostname. */
const postSchema = z.object({
  hostname: host,
  mode: z.enum(["skip", "off"]).nullable(),
});

/** Single-site write (extension toolbar toggle): mode null removes the row. */
export async function POST(req: Request): Promise<Response> {
  const who = await caller(req);
  if (!who) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`settings:${who.userId}`, RATE_LIMIT);
  if (!limit.ok) return limited(limit.retryAfterMs);
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = postSchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  const { hostname, mode } = parsed.data;
  const db = getDb();
  if (who.persisted && db) {
    if (mode === null) await db.sites.remove(who.userId, hostname);
    else await db.sites.set(who.userId, hostname, mode as SiteMode);
  } else {
    const sites = memorySites(who.userId).filter((s) => s.hostname !== hostname);
    if (mode !== null) sites.push({ hostname, mode: mode as SiteMode });
    setMemorySites(who.userId, sites);
  }
  return Response.json({ sites: await read(who.userId, who.persisted) });
}

export async function PUT(req: Request): Promise<Response> {
  const who = await caller(req);
  if (!who) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`settings:${who.userId}`, RATE_LIMIT);
  if (!limit.ok) return limited(limit.retryAfterMs);
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
    await db.sites.replace(who.userId, sites.map((s) => ({ hostname: s.hostname, mode: s.mode as SiteMode })));
  } else {
    setMemorySites(who.userId, sites);
  }
  return Response.json({ sites: await read(who.userId, who.persisted) });
}
