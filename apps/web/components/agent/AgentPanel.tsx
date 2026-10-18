"use client";

import { useState } from "react";
import type { RankedCandidate, RenderPlan, TasteProfile } from "@focal-ai/core";
import { QUICK_PROMPTS, runAgent, type AgentResult, type AgentStep } from "@/lib/client/agent";
import type { DemoPage, RankMeta } from "@/lib/client/types";

export function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function summarizePreview(summary: RenderPlan["summary"]): string {
  return `${summary.moved} moved · ${summary.collapsed} collapsed · ${summary.unresolved} unresolved`;
}

interface AgentPanelProps {
  page: DemoPage;
  profile: TasteProfile;
  onProfileChange: (profile: TasteProfile) => void;
  onApply: (result: { ranked: RankedCandidate[]; plan: RenderPlan; meta: RankMeta }) => void;
}

interface AgentRun {
  steps: AgentStep[];
  message: string;
  result: AgentResult | null;
}

const PRIMARY_BUTTON =
  "rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded-md border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-muted/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h4>
  );
}

export function AgentPanel({ page, profile, onProfileChange, onApply }: AgentPanelProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);

  async function ask(message: string) {
    const trimmed = message.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      const response = await runAgent({ message: trimmed, page, profile });
      setRun({ steps: response.steps, message: response.message, result: response.result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent request failed");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  function handleApplyPolicy(result: Extract<AgentResult, { kind: "policy" }>) {
    onProfileChange({
      ...profile,
      rules: [...profile.rules, ...result.rules].slice(0, 20),
      updatedAt: new Date().toISOString(),
    });
    onApply(result.preview);
  }

  function handleDismiss() {
    setRun((prev) => (prev === null ? prev : { ...prev, result: null }));
  }

  const result = run?.result ?? null;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto">
      <header>
        <h2 className="text-sm font-semibold text-ink">Ask focal</h2>
        <p className="mt-1 text-xs text-muted">
          A deterministic agent: it reads your taste, calls Qloo, and proposes changes you approve.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(prompt);
              void ask(prompt);
            }}
            className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-muted/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Hide chains and boost natural wine"
          aria-label="Ask the agent"
          disabled={busy}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink placeholder:text-muted transition-colors focus-visible:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button type="submit" disabled={busy || draft.trim().length === 0} className={PRIMARY_BUTTON}>
          {busy ? "Working…" : "Ask"}
        </button>
      </form>

      {error !== null ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5" aria-live="polite">
        {busy ? (
          <div className="flex animate-pulse items-center gap-2">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-muted" />
            <span className="shrink-0 font-mono text-[11px] text-ink">agent</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted">Planning…</span>
          </div>
        ) : (
          run?.steps.map((step, index) => (
            <div key={index} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${
                  step.status === "ok" ? "bg-positive" : "bg-danger"
                }`}
              />
              <span className="sr-only">{step.status === "ok" ? "Succeeded" : "Failed"}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink">{step.tool}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={step.summary}>
                {step.summary}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                {formatStepDuration(step.durationMs)}
              </span>
            </div>
          ))
        )}
      </div>

      {run !== null ? <p className="text-xs text-ink">{run.message}</p> : null}

      {result !== null ? (
        result.kind === "rank" ? (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3">
            <p className="text-xs text-muted">
              Ranked{" "}
              <span className="font-mono tabular-nums text-ink">{result.ranked.length}</span> results ·{" "}
              <span className="font-mono tabular-nums text-ink">{result.meta.durationMs}</span>ms ·{" "}
              <span className="font-mono tabular-nums text-ink">{result.meta.unresolved}</span> left in
              place
            </p>
            <button
              type="button"
              onClick={() => onApply({ ranked: result.ranked, plan: result.plan, meta: result.meta })}
              className={PRIMARY_BUTTON}
            >
              Show on page
            </button>
          </div>
        ) : result.kind === "policy" ? (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3">
            <div className="flex flex-col gap-1.5">
              <SectionHeading>Proposed rules</SectionHeading>
              <ul className="flex flex-col gap-1">
                {result.rulesHuman.map((rule, index) => (
                  <li key={index} className="font-mono text-[11px] text-ink">
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-[11px] tabular-nums text-muted">
              {summarizePreview(result.preview.plan.summary)}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleApplyPolicy(result)}
                className={PRIMARY_BUTTON}
              >
                Apply to profile
              </button>
              <button type="button" onClick={handleDismiss} className={SECONDARY_BUTTON}>
                Dismiss
              </button>
            </div>
          </div>
        ) : result.kind === "discovery" ? (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3">
            <ul className="flex flex-col gap-2">
              {result.items.map((item, index) => (
                <li key={index} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink">{item.name}</p>
                    {item.disambiguation !== undefined ? (
                      <p className="truncate text-[11px] text-muted">{item.disambiguation}</p>
                    ) : null}
                  </div>
                  {item.affinityPct != null ? (
                    <span className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted">
                      {item.affinityPct}%
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted">Add via the taste panel search.</p>
          </div>
        ) : result.kind === "explanation" ? (
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <ul className="flex flex-col gap-2.5">
              {result.items.map((item, index) => (
                <li key={index} className="flex flex-col gap-0.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs font-medium text-ink">{item.name}</span>
                    {item.affinityPct != null ? (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                        {item.affinityPct}%
                      </span>
                    ) : null}
                  </div>
                  {item.reason !== undefined ? (
                    <p className="text-[11px] text-muted">{item.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            <p className="text-xs text-danger">{result.detail}</p>
          </div>
        )
      ) : null}
    </section>
  );
}

export default AgentPanel;
