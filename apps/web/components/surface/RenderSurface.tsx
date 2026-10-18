"use client";

import type { RankedCandidate } from "@focal-ai/core";
import type { DemoPage, RankResponse, SurfaceMode } from "@/lib/client/types";
import { ListingCard } from "./ListingCard";

const SKELETON_COUNT = 6;

interface RenderSurfaceProps {
  page: DemoPage;
  response: RankResponse | null;
  mode: SurfaceMode;
  busy: boolean;
}

function SkeletonCard() {
  return (
    <li aria-hidden="true" className="animate-pulse rounded-lg border border-line bg-surface p-3">
      <div className="flex gap-3">
        <div className="size-10 shrink-0 rounded-md bg-surface-2" />
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <div className="h-3 w-1/3 rounded bg-surface-2" />
          <div className="h-2.5 w-2/3 rounded bg-surface-2" />
          <div className="h-2.5 w-5/6 rounded bg-surface-2" />
        </div>
      </div>
    </li>
  );
}

function DiffStrip({ page, response }: { page: DemoPage; response: RankResponse }) {
  const { summary } = response.plan;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
      <span className="font-mono tabular-nums text-ink">{summary.moved}</span> of{" "}
      <span className="font-mono tabular-nums text-ink">{page.candidates.length}</span> moved ·{" "}
      <span className="font-mono tabular-nums text-ink">{summary.collapsed}</span> collapsed · avg{" "}
      <span className="font-mono tabular-nums text-ink">{summary.avgMovement}</span> positions
    </div>
  );
}

export function RenderSurface({ page, response, mode, busy }: RenderSurfaceProps) {
  const rankedByClientId = new Map<string, RankedCandidate>(
    response !== null ? response.ranked.map((ranked) => [ranked.clientId, ranked]) : [],
  );
  const rankedOrder = mode !== "original" && response !== null;

  const items = [...page.candidates]
    .map((candidate) => ({ candidate, ranked: rankedByClientId.get(candidate.clientId) }))
    .sort((a, b) => {
      if (rankedOrder) {
        const positionA = a.ranked?.position ?? Number.MAX_SAFE_INTEGER;
        const positionB = b.ranked?.position ?? Number.MAX_SAFE_INTEGER;
        if (positionA !== positionB) return positionA - positionB;
      }
      return a.candidate.originalIndex - b.candidate.originalIndex;
    });

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{page.name}</h1>
          {page.id !== "paste" ? (
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
              Demo directory
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted">{page.kind}</p>
      </header>

      <p className="text-xs text-muted">
        {busy ? (
          "Ranking against your taste…"
        ) : response !== null ? (
          <>
            Ranked against your taste ·{" "}
            <span className="font-mono tabular-nums text-ink">{response.meta.durationMs}</span>ms ·{" "}
            <span className="font-mono tabular-nums text-ink">{response.meta.unresolved}</span> left
            in place
          </>
        ) : (
          "This is the page as its site ranks it. Focus to re-rank against your taste."
        )}
      </p>

      {mode === "diff" && response !== null ? (
        <DiffStrip page={page} response={response} />
      ) : null}

      <ol
        role="list"
        data-container-id={page.containerId}
        aria-busy={busy}
        aria-label={`${page.name} results`}
        className="flex flex-col gap-2"
      >
        {busy
          ? Array.from({ length: SKELETON_COUNT }, (_, index) => <SkeletonCard key={index} />)
          : items.map(({ candidate, ranked }) => {
              const delta =
                mode === "diff" && ranked !== undefined
                  ? ranked.position - candidate.originalIndex
                  : undefined;
              return (
                <li key={candidate.clientId}>
                  <ListingCard
                    candidate={candidate}
                    ranked={ranked}
                    mode={mode}
                    delta={delta}
                  />
                </li>
              );
            })}
      </ol>
    </section>
  );
}

export default RenderSurface;
