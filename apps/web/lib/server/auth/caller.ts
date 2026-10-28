import { currentViewer } from "./viewer";
import { resolveSession } from "../page/session";

export interface Caller {
  userId: string;
  persisted: boolean;
  via: "cookie" | "bearer";
}

/** Website cookie or extension bearer session; null when signed out. */
export async function caller(req: Request): Promise<Caller | null> {
  // An Authorization header means an extension call — never let the website
  // cookie (or dev) viewer shadow it. Cookie-only requests use currentViewer.
  const session = await resolveSession(req);
  if (session) return { userId: session.userId, persisted: true, via: "bearer" };
  const viewer = await currentViewer();
  return viewer ? { userId: viewer.userId, persisted: viewer.persisted, via: "cookie" } : null;
}
