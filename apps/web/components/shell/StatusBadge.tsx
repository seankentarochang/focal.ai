"use client";

import type { HealthResponse } from "@/lib/client/types";

interface StatusBadgeProps {
  health: HealthResponse | null;
  seedCount: number;
}

const PILL =
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4";

export function StatusBadge({ health, seedCount }: StatusBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      {health === null ? (
        <span className={`${PILL} border-line bg-surface text-muted`}>checking…</span>
      ) : !health.hasQlooKey ? (
        <span className={`${PILL} border-warning/40 bg-warning/10 text-warning`}>
          Qloo key not configured
        </span>
      ) : health.dataSource === "mock" ? (
        <span className={`${PILL} border-warning/40 bg-warning/10 text-warning`}>
          MOCK DATA
        </span>
      ) : (
        <span className={`${PILL} border-line bg-surface text-ink`}>
          <span className="size-1.5 rounded-full bg-positive" aria-hidden="true" />
          Qloo connected
        </span>
      )}
      <span className="text-[11px] text-muted">
        <span className="font-mono tabular-nums">{seedCount}</span> seeds
      </span>
    </div>
  );
}

export default StatusBadge;
