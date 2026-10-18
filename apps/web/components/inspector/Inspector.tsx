"use client";

import type { RenderOp } from "@focal-ai/core";
import type { DemoPage, RankResponse } from "@/lib/client/types";

const MAX_VALUE_LENGTH = 60;
const MAX_EVIDENCE = 3;

interface InspectorProps {
  page: DemoPage;
  response: RankResponse | null;
  error: string | null;
  busy: boolean;
}

function truncate(value: string, max = MAX_VALUE_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function planLines(ops: RenderOp[]): string[] {
  const lines: string[] = [];
  let annotateCount = 0;
  let emphasizeCount = 0;
  for (const op of ops) {
    switch (op.op) {
      case "reorder":
        lines.push(`reorder · ${op.order.length} items`);
        break;
      case "collapse":
        lines.push(`collapse · ${op.label}`);
        break;
      case "hide":
        lines.push(`hide · ${op.label}`);
        break;
      case "annotate":
        annotateCount += 1;
        break;
      case "emphasize":
        emphasizeCount += 1;
        break;
    }
  }
  if (annotateCount > 0) lines.push(`annotate · ${annotateCount} items`);
  if (emphasizeCount > 0) lines.push(`emphasize · ${emphasizeCount} items`);
  return lines;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h3>
  );
}

function KeyValueRow({ label, value }: { label: string; value: string }) {
  const display = truncate(value);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11px] text-muted">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-[11px] text-ink" title={value}>
        {display}
      </dd>
    </div>
  );
}

export function Inspector({ page, response, error, busy }: InspectorProps) {
  const evidence =
    response !== null
      ? response.ranked
          .filter((ranked) => ranked.reason?.text)
          .sort((a, b) => a.position - b.position)
          .slice(0, MAX_EVIDENCE)
      : [];

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:self-start lg:overflow-y-auto">
      <h2 className="text-sm font-semibold text-ink">Inspector</h2>

      {busy ? (
        <p className="animate-pulse text-xs text-muted">Ranking…</p>
      ) : error !== null ? (
        <p className="text-xs text-danger">{error}</p>
      ) : response === null ? (
        <p className="text-xs text-muted">
          Focus the page to see exactly what focal.ai sent to Qloo and why each item moved.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <SectionHeading>Qloo request</SectionHeading>
            <dl className="flex flex-col gap-1.5">
              <KeyValueRow label="path" value={response.meta.qlooRequest.path} />
              {Object.entries(response.meta.qlooRequest.params).map(([key, value]) => (
                <KeyValueRow key={key} label={key} value={value} />
              ))}
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <SectionHeading>Result</SectionHeading>
            <dl className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">source</dt>
                <dd>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                      response.meta.dataSource === "live"
                        ? "border-positive/30 bg-positive/10 text-positive"
                        : "border-warning/40 bg-warning/10 text-warning"
                    }`}
                  >
                    {response.meta.dataSource}
                  </span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">duration</dt>
                <dd className="font-mono text-[11px] tabular-nums text-ink">
                  {response.meta.durationMs}ms
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">unresolved</dt>
                <dd className="font-mono text-[11px] tabular-nums text-ink">
                  {response.meta.unresolved}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <SectionHeading>Plan</SectionHeading>
            <ul className="flex flex-col gap-1">
              {planLines(response.plan.ops).map((line, index) => (
                <li key={index} className="font-mono text-[11px] text-ink">
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <SectionHeading>Evidence</SectionHeading>
            {evidence.length === 0 ? (
              <p className="text-xs text-muted">No grounded reasons for this profile yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {evidence.map((ranked) => (
                  <li key={ranked.clientId} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-xs font-medium text-ink">{ranked.name}</span>
                      {ranked.affinityPct != null ? (
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                          {ranked.affinityPct}%
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-muted">{ranked.reason?.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default Inspector;
