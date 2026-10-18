"use client";

import type { RankedCandidate } from "@focal-ai/core";
import type { DemoCandidate, SurfaceMode } from "@/lib/client/types";

const INITIAL_PALETTE = [
  { bg: "rgba(110, 86, 207, 0.22)", fg: "#BCA9F6" },
  { bg: "rgba(74, 222, 128, 0.16)", fg: "#86E7A6" },
  { bg: "rgba(251, 191, 36, 0.16)", fg: "#F0D083" },
  { bg: "rgba(96, 165, 250, 0.16)", fg: "#9CC2F7" },
  { bg: "rgba(244, 114, 182, 0.16)", fg: "#EEA3C7" },
  { bg: "rgba(45, 212, 191, 0.16)", fg: "#85DCD0" },
];

function hashClientId(clientId: string): number {
  let hash = 0;
  for (let i = 0; i < clientId.length; i += 1) {
    hash = (hash * 31 + clientId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface ListingCardProps {
  candidate: DemoCandidate;
  ranked?: RankedCandidate;
  mode: SurfaceMode;
  delta?: number;
}

export function ListingCard({ candidate, ranked, mode, delta }: ListingCardProps) {
  const swatch = INITIAL_PALETTE[hashClientId(candidate.clientId) % INITIAL_PALETTE.length];
  const initial = candidate.name.trim().charAt(0).toUpperCase();
  const showDelta = mode === "diff" && delta !== undefined && delta !== 0;

  return (
    <article
      data-client-id={candidate.clientId}
      data-role="card"
      data-sponsored={candidate.sponsored ? "true" : undefined}
      className={`flex gap-3 rounded-lg border border-line bg-surface p-3 transition-colors ${
        showDelta ? "border-l-2 border-l-accent" : ""
      }`}
    >
      <div
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-md font-mono text-sm font-semibold"
        style={{ backgroundColor: swatch.bg, color: swatch.fg }}
      >
        {initial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink">{candidate.name}</h3>
            {ranked?.reason?.text ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{ranked.reason.text}</p>
            ) : null}
            {candidate.meta.length > 0 ? (
              <p className="mt-0.5 truncate text-xs text-muted">{candidate.meta}</p>
            ) : null}
            {candidate.blurb.length > 0 ? (
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted">
                {candidate.blurb}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {candidate.sponsored ? (
              <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                Sponsored
              </span>
            ) : null}
            {ranked?.affinityPct != null ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] tabular-nums text-ink">
                {ranked.affinityPct}% match
              </span>
            ) : null}
            {showDelta ? (
              <span
                title={delta < 0 ? `Moved up ${Math.abs(delta)}` : `Moved down ${delta}`}
                className="font-mono text-[10px] tabular-nums text-accent"
              >
                {delta < 0 ? `▲${Math.abs(delta)}` : `▼${delta}`}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default ListingCard;
