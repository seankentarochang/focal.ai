import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { WhyView } from "@/components/why/WhyView";
import { authEnabled } from "@/lib/server/auth/config";
import { currentViewer } from "@/lib/server/auth/viewer";
import { getPageResultStore } from "@/lib/server/page/store";
import { buildWhyView } from "@/lib/why";

async function Why({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const viewer = await currentViewer();
  if (!viewer) {
    if (authEnabled()) redirect(`/sign-in?returnTo=${encodeURIComponent(`/why/${id}`)}`);
    notFound();
  }
  const row = await getPageResultStore().get(id, viewer.userId);
  if (!row) notFound();
  return <WhyView view={buildWhyView(row)} />;
}

export default function WhyPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10">
        <Suspense
          fallback={
            <div className="flex flex-col gap-4">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40 w-full" />
            </div>
          }
        >
          <Why params={params} />
        </Suspense>
      </main>
    </>
  );
}
