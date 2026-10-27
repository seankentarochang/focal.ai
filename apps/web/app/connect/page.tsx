import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { connection } from "next/server";
import { ConnectAssistants } from "@/components/connect/ConnectAssistants";
import { ConnectExtension } from "@/components/connect/ConnectExtension";
import { authEnabled } from "@/lib/server/auth/config";

async function Connect() {
  await connection();
  if (!authEnabled()) notFound();
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (!user) redirect("/sign-in");
  const h = await headers();
  const origin =
    process.env.FOCAL_PUBLIC_URL?.replace(/\/+$/, "") ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  return (
    <>
      <p className="text-sm opacity-80">Signed in as {user.email}.</p>
      <ConnectExtension extensionId={process.env.NEXT_PUBLIC_FOCAL_EXTENSION_ID ?? ""} />
      <section id="assistants" className="mt-8 flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Connect an assistant</h2>
        <ConnectAssistants mcpUrl={`${origin}/mcp`} />
      </section>
    </>
  );
}

export default function ConnectPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Connect focal</h1>
      <Suspense fallback={<p className="text-sm opacity-80">Checking sign-in…</p>}>
        <Connect />
      </Suspense>
    </main>
  );
}
