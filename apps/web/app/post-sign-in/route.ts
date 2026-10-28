import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";
import { currentViewer } from "@/lib/server/auth/viewer";
import { getDb } from "@/lib/server/db";

/** Post-auth fork: brand-new profiles start on onboarding; everyone else lands on /connect. */
export async function GET(): Promise<Response> {
  await connection();
  if (!authEnabled()) return authDisabledResponse();
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (!user) redirect("/sign-in");
  const viewer = await currentViewer();
  const db = getDb();
  if (viewer && db) {
    const profile = await db.profile.load(viewer.userId);
    if (profile.entries.length === 0) redirect("/onboarding");
  }
  redirect("/connect");
}
