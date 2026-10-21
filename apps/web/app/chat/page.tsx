import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled } from "@/lib/server/auth/config";
import { currentViewer } from "@/lib/server/auth/viewer";

async function ChatGate() {
  await connection();
  const viewer = await currentViewer();
  if (!viewer) {
    if (authEnabled()) redirect("/sign-in?returnTo=%2Fchat");
    notFound();
  }
  return <ChatPanel email={viewer.email} />;
}

export default function ChatPage() {
  return (
    <>
      <SiteHeader active="/chat" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
        <Suspense fallback={<Skeleton className="h-[60vh] w-full rounded-xl" />}>
          <ChatGate />
        </Suspense>
      </main>
    </>
  );
}
