import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ActivityFeed } from "@/components/site/ActivityFeed";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled } from "@/lib/server/auth/config";
import { currentViewer } from "@/lib/server/auth/viewer";
import { getDb } from "@/lib/server/db";

const LIMIT = 50;

async function ActivityGate({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await connection();
  if (!authEnabled()) notFound();
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (!user) redirect("/sign-in?returnTo=%2Factivity");
  const { before } = await searchParams;
  const viewer = await currentViewer();
  const db = getDb();
  const activity =
    viewer && db ? await db.profile.activity(viewer.userId, { limit: LIMIT, ...(before ? { before } : {}) }) : [];
  return <ActivityFeed activity={activity} hasMore={activity.length === LIMIT} />;
}

export default function ActivityPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  return (
    <>
      <SiteHeader active="/activity" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <Suspense fallback={<Skeleton className="h-[40vh] w-full rounded-xl" />}>
          <ActivityGate searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}
