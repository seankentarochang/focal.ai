import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ConnectExtension } from "@/components/connect/ConnectExtension";
import { authEnabled } from "@/lib/server/auth/config";

async function Connect() {
  await connection();
  if (!authEnabled()) notFound();
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth({ ensureSignedIn: true });
  return (
    <>
      <p className="text-sm opacity-80">Signed in as {user.email}.</p>
      <ConnectExtension extensionId={process.env.NEXT_PUBLIC_FOCAL_EXTENSION_ID ?? ""} />
    </>
  );
}

export default function ConnectPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Connect the focal extension</h1>
      <Suspense fallback={<p className="text-sm opacity-80">Checking sign-in…</p>}>
        <Connect />
      </Suspense>
    </main>
  );
}
