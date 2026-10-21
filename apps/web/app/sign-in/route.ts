import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";
import { safeReturnTo } from "@/lib/server/auth/returnTo";

export async function GET(req: Request): Promise<Response> {
  await connection();
  if (!authEnabled()) return authDisabledResponse();
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));
  const { getSignInUrl } = await import("@workos-inc/authkit-nextjs");
  redirect(await getSignInUrl({ returnTo }));
}
