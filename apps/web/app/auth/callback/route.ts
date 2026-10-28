import { DbError } from "@focal-ai/db";
import { connection, NextResponse, type NextRequest } from "next/server";
import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";
import { ensureUser } from "@/lib/server/auth/users";
import { getDb } from "@/lib/server/db";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  if (!authEnabled()) return authDisabledResponse();
  const { handleAuth } = await import("@workos-inc/authkit-nextjs");
  try {
    return await handleAuth({
      returnPathname: "/post-sign-in",
      onSuccess: async ({ user }) => {
        const db = getDb();
        if (db && user.email) await ensureUser(db, { id: user.id, email: user.email, emailVerified: user.emailVerified === true });
      },
    })(request);
  } catch (e) {
    if (e instanceof DbError && e.code === "CONFLICT") {
      return NextResponse.redirect(new URL("/sign-in?error=account", request.url));
    }
    throw e;
  }
}
