import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";

export async function GET(): Promise<Response> {
  await connection();
  if (!authEnabled()) return authDisabledResponse();
  const { getSignInUrl } = await import("@workos-inc/authkit-nextjs");
  redirect(await getSignInUrl());
}
