"use client";

import { useState, type FormEvent } from "react";
import { buildPastePage, parsePastedList } from "@/lib/client/paste";
import type { DemoPage } from "@/lib/client/types";

export const PASTE_TYPE_OPTIONS = [
  { label: "Place", value: "urn:entity:place" },
  { label: "Brand", value: "urn:entity:brand" },
  { label: "Movie", value: "urn:entity:movie" },
  { label: "Artist", value: "urn:entity:artist" },
  { label: "TV show", value: "urn:entity:tv_show" },
] as const;

const FIELD_CLASS =
  "h-9 rounded-md border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/30";

interface PasteListProps {
  onReady: (page: DemoPage) => void;
}

export function PasteList({ onReady }: PasteListProps) {
  const [text, setText] = useState("");
  const [type, setType] = useState<string>(PASTE_TYPE_OPTIONS[0].value);
  const [location, setLocation] = useState("");

  const names = parsePastedList(text);
  const canSubmit = names.length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const locationQuery = location.trim();
    onReady(
      buildPastePage(names, {
        type,
        locationQuery: locationQuery.length > 0 ? locationQuery : undefined,
      }),
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Paste any list</h1>
        <p className="mt-0.5 text-xs text-muted">
          Bring names from any site or notes app. focal.ai resolves them through Qloo and re-ranks
          the list against your taste.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink">Names, one per line</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder="Paste restaurant names, one per line — from OpenTable, a notes app, anywhere."
            className="resize-y rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink">Type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={FIELD_CLASS}
            >
              {PASTE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-ink">Location</span>
            <input
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="City (optional) — e.g. Lisbon"
              className={FIELD_CLASS}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            {names.length === 0
              ? "Names are read one per line, up to 50."
              : `${names.length} name${names.length === 1 ? "" : "s"} ready`}
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use this list
          </button>
        </div>
      </form>
    </section>
  );
}

export default PasteList;
