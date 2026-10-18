"use client";

import { useState } from "react";
import type { RankedCandidate, RenderPlan, TasteProfile } from "@focal-ai/core";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { Inspector } from "@/components/inspector/Inspector";
import type { DemoPage, RankMeta, RankResponse } from "@/lib/client/types";

type RightRailTab = "inspector" | "agent";

const TABS: { id: RightRailTab; label: string }[] = [
  { id: "inspector", label: "Inspector" },
  { id: "agent", label: "Ask focal" },
];

interface RightRailProps {
  page: DemoPage;
  response: RankResponse | null;
  error: string | null;
  busy: boolean;
  profile: TasteProfile;
  onProfileChange: (profile: TasteProfile) => void;
  onApply: (result: { ranked: RankedCandidate[]; plan: RenderPlan; meta: RankMeta }) => void;
}

export function RightRail({
  page,
  response,
  error,
  busy,
  profile,
  onProfileChange,
  onApply,
}: RightRailProps) {
  const [tab, setTab] = useState<RightRailTab>("inspector");

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-[76px] lg:self-start">
      <div
        role="tablist"
        aria-label="Right rail views"
        className="inline-flex items-center gap-0.5 self-start rounded-lg border border-line bg-surface p-0.5"
      >
        {TABS.map((option) => {
          const active = tab === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(option.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                active ? "bg-accent-soft text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className={tab === "inspector" ? "" : "hidden"}>
        <Inspector page={page} response={response} error={error} busy={busy} />
      </div>

      <div className={tab === "agent" ? "" : "hidden"}>
        <AgentPanel
          key={page.id}
          page={page}
          profile={profile}
          onProfileChange={onProfileChange}
          onApply={onApply}
        />
      </div>
    </div>
  );
}

export default RightRail;
