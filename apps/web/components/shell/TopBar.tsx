"use client";

import Image from "next/image";
import type { HealthResponse, PageId, SurfaceMode } from "@/lib/client/types";
import { ModeSwitcher } from "./ModeSwitcher";
import { StatusBadge } from "./StatusBadge";

export interface TopBarTab {
  id: PageId;
  label: string;
  count: number;
}

interface TopBarProps {
  tabs: TopBarTab[];
  pageId: PageId;
  onPageChange: (id: PageId) => void;
  mode: SurfaceMode;
  onModeChange: (mode: SurfaceMode) => void;
  hasResponse: boolean;
  canFocus: boolean;
  busy: boolean;
  onFocus: () => void;
  onReset: () => void;
  health: HealthResponse | null;
  seedCount: number;
}

export function TopBar({
  tabs,
  pageId,
  onPageChange,
  mode,
  onModeChange,
  hasResponse,
  canFocus,
  busy,
  onFocus,
  onReset,
  health,
  seedCount,
}: TopBarProps) {
  const candidateCount = tabs.find((tab) => tab.id === pageId)?.count ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <span className="flex items-center gap-2">
          <Image src="/logo.svg" alt="" width={22} height={22} priority aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight text-ink">focal.ai</span>
        </span>

        <nav className="flex items-center gap-0.5" aria-label="Demo pages">
          {tabs.map((tab) => {
            const active = tab.id === pageId;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onPageChange(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                  active
                    ? "bg-surface-2 text-ink"
                    : "text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusBadge health={health} seedCount={seedCount} />

          <ModeSwitcher mode={mode} onChange={onModeChange} disabled={!hasResponse} />

          <button
            type="button"
            onClick={onFocus}
            disabled={!canFocus || busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? "Focusing…"
              : `Focus ${candidateCount} result${candidateCount === 1 ? "" : "s"}`}
          </button>

          {hasResponse ? (
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-muted/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default TopBar;
