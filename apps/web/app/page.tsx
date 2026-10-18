"use client";

import { useEffect, useState } from "react";
import { Inspector } from "@/components/inspector/Inspector";
import { ProfilePanel } from "@/components/profile/ProfilePanel";
import { TopBar } from "@/components/shell/TopBar";
import { RenderSurface } from "@/components/surface/RenderSurface";
import { getHealth, rankPage } from "@/lib/client/api";
import { useProfile } from "@/lib/client/store";
import type {
  DemoPage,
  HealthResponse,
  PageId,
  RankResponse,
  SurfaceMode,
} from "@/lib/client/types";
import { getPage, PAGES } from "@/lib/pages";

const PAGE_LIST: DemoPage[] = [PAGES.tables, PAGES.atlas, PAGES.verve];

export default function Home() {
  return <FocalApp />;
}

function FocalApp() {
  const [pageId, setPageId] = useState<PageId>("tables");
  const [response, setResponse] = useState<RankResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SurfaceMode>("original");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const { profile, setProfile, reset } = useProfile();

  const page = getPage(pageId);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  function handlePageChange(id: PageId) {
    setPageId(id);
    setResponse(null);
    setMode("original");
    setError(null);
  }

  const canFocus = profile.seeds.some((seed) => seed.polarity === "like") && !busy;

  async function handleFocus() {
    if (!canFocus) return;
    setBusy(true);
    setError(null);
    try {
      const ranked = await rankPage({ page, profile });
      setResponse(ranked);
      setMode("focal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ranking failed");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setResponse(null);
    setMode("original");
    setError(null);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        pages={PAGE_LIST}
        pageId={pageId}
        onPageChange={handlePageChange}
        mode={mode}
        onModeChange={setMode}
        hasResponse={response !== null}
        canFocus={canFocus}
        busy={busy}
        onFocus={() => void handleFocus()}
        onReset={handleReset}
        health={health}
        seedCount={profile.seeds.length}
      />

      <main className="mx-auto grid w-full max-w-[1400px] gap-4 px-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <ProfilePanel profile={profile} onProfileChange={setProfile} />

        <div className="flex min-w-0 flex-col gap-4">
          {error !== null ? (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3"
            >
              <p className="text-sm font-medium text-danger">{error}</p>
              <p className="mt-1 text-xs text-muted">
                Check that QLOO_API_KEY is set (or QLOO_MOCK=1 for local demo data).
              </p>
            </div>
          ) : null}

          <RenderSurface page={page} response={response} mode={mode} busy={busy} />
        </div>

        <Inspector page={page} response={response} error={error} busy={busy} />
      </main>
    </div>
  );
}
