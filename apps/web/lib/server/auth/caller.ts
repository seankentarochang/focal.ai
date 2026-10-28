import { currentViewer } from "./viewer";
import { resolveSession } from "../page/session";

export interface Caller {
  userId: string;
  persisted: boolean;
  via: "cookie" | "bearer";
}

/** Website cookie or extension bearer session; null when signed out. */
export async function caller(req: Request): Promise<Caller | null> {
  const viewer = await currentViewer();
  if (viewer) return { userId: viewer.userId, persisted: viewer.persisted, via: "cookie" };
  const session = await resolveSession(req);
  return session ? { userId: session.userId, persisted: true, via: "bearer" } : null;
}
