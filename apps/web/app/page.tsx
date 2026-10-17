import { Suspense } from "react";
import Image from "next/image";
import { headers } from "next/headers";
import { VERSION } from "@focal-ai/core";

type Health = {
  ok: boolean;
  hasQlooKey: boolean;
  dataSource: "live" | "mock";
};

async function fetchHealth(): Promise<Health | null> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? "http";
  try {
    const res = await fetch(`${proto}://${host}/api/health`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

async function HealthStatus() {
  const health = await fetchHealth();
  if (!health) {
    return <p className="text-sm text-zinc-500">status: unavailable</p>;
  }
  return (
    <p className="text-sm text-zinc-400">
      Qloo key:{" "}
      <span className="text-[#6E56CF]">
        {health.hasQlooKey ? "configured" : "missing"}
      </span>
      {" · "}
      data source: <span className="text-[#6E56CF]">{health.dataSource}</span>
    </p>
  );
}

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0a0a0b] px-6 text-center text-zinc-100">
      <Image src="/logo.svg" alt="focal.ai logo" width={64} height={64} priority />
      <h1 className="text-4xl font-semibold tracking-tight">focal.ai</h1>
      <p className="text-lg text-zinc-400">The web, rendered for you.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">checking Qloo status…</p>}>
        <HealthStatus />
      </Suspense>
      <p className="text-[10px] text-zinc-600">core v{VERSION}</p>
    </main>
  );
}
