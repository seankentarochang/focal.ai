import type { ProfileV2 } from "@focal-ai/core";
import { getDb } from "../db";

export interface PageSession {
  userId: string;
  profile: ProfileV2;
}

/**
 * Dev-only demo profile until accounts land (P-02): loves Fugazi (artist) and
 * likes Rintaro, so place pages get a cross-domain signal plus a page-type one.
 */
const DEV_PROFILE: ProfileV2 = {
  version: 2,
  updatedAt: "2026-10-20T00:00:00.000Z",
  entries: [
    {
      id: "dev-fugazi",
      kind: "thing",
      qlooId: "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948",
      name: "Fugazi",
      type: "urn:entity:artist",
      strength: "love",
      source: "manual",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
    {
      id: "dev-rintaro",
      kind: "thing",
      qlooId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01",
      name: "Rintaro",
      type: "urn:entity:place",
      strength: "like",
      source: "manual",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  ],
};

export function devSessionsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.FOCAL_DEV_SESSION === "1";
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S{1,512})$/i.exec(req.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}

/**
 * Resolves the caller from the extension's bearer token: an extension session
 * in Postgres when the database is configured, else the dev demo session.
 */
export async function resolveSession(req: Request): Promise<PageSession | null> {
  const token = bearer(req);
  if (!token) return null;
  const db = getDb();
  if (db) {
    const session = await db.extensionSessions.resolve(token);
    if (!session) return null;
    const { entries } = await db.profile.load(session.userId);
    const profile: ProfileV2 = { version: 2, updatedAt: new Date().toISOString(), entries: entries as unknown as ProfileV2["entries"] };
    return { userId: session.userId, profile };
  }
  if (devSessionsEnabled()) return { userId: "dev", profile: DEV_PROFILE };
  return null;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
}
