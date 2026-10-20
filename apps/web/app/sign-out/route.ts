import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";

export async function POST(): Promise<Response> {
  if (!authEnabled()) return authDisabledResponse();
  const { signOut } = await import("@workos-inc/authkit-nextjs");
  await signOut({ returnTo: "/" });
  return new Response(null, { status: 204 });
}
