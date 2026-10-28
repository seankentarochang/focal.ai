import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";
import { safeReturnTo } from "@/lib/server/auth/returnTo";

export async function GET(req: Request): Promise<Response> {
  await connection();
  if (!authEnabled()) return authDisabledResponse();
  const url = new URL(req.url);
  if (url.searchParams.get("error") === "account") redirect("/?error=account");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const { getSignInUrl } = await import("@workos-inc/authkit-nextjs");
  redirect(await getSignInUrl({ returnTo }));
}
