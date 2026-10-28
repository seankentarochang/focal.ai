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
  // cookie (or dev) viewer shadow it. A bearer that doesn't resolve fails
  // closed: never fall through to the cookie viewer on a bearer request.
  if (req.headers.get("authorization")) {
    const session = await resolveSession(req);
    return session ? { userId: session.userId, persisted: true, via: "bearer" } : null;
  }
  const viewer = await currentViewer();
  return viewer ? { userId: viewer.userId, persisted: viewer.persisted, via: "cookie" } : null;
}
