import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { OnboardingFlow } from "@/components/site/OnboardingFlow";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled } from "@/lib/server/auth/config";
import { currentViewer } from "@/lib/server/auth/viewer";

async function OnboardingGate() {
  await connection();
  if (!authEnabled()) notFound();
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (!user) redirect("/sign-in?returnTo=%2Fonboarding");
  const viewer = await currentViewer();
  return <OnboardingFlow email={viewer?.email ?? user.email} extensionId={process.env.NEXT_PUBLIC_FOCAL_EXTENSION_ID ?? ""} />;
}

export default function OnboardingPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Get started</h1>
        <Suspense fallback={<Skeleton className="h-[60vh] w-full rounded-xl" />}>
          <OnboardingGate />
        </Suspense>
      </main>
    </>
  );
}
