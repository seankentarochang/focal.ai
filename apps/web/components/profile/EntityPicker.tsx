"use client";

import { useState } from "react";
import type { TasteSeed } from "@focal-ai/core";
import type { QlooEntity } from "@focal-ai/qloo";
import { searchEntities } from "@/lib/client/api";

const MAX_RESULTS = 5;

function shortSubtype(subtype: string): string {
  const segments = subtype.split(":");
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : subtype;
}

interface EntityPickerProps {
  onAdd: (seed: TasteSeed) => void;
  disabled?: boolean;
}

export function EntityPicker({ onAdd, disabled = false }: EntityPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QlooEntity[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    const trimmed = query.trim();
    if (trimmed.length === 0 || searching || disabled) return;
    setSearching(true);
    setError(null);
    try {
      const response = await searchEntities({ query: trimmed });
      setResults(response.entities.slice(0, MAX_RESULTS));
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function handleAdd(entity: QlooEntity) {
    onAdd({
      entityId: entity.entityId,
      name: entity.name,
      subtype: entity.subtype,
      disambiguation: entity.disambiguation,
      polarity: "like",
      weight: 1,
      source: "searched",
      addedAt: new Date().toISOString(),
    });
    setQuery("");
    setResults(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSearch();
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search artists, films, places…"
          disabled={disabled}
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || searching || query.trim().length === 0}
          className="h-9 shrink-0 rounded-md border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Search
        </button>
      </form>

      <p className="text-[11px] text-muted">
        Try: Rintaro · Fugazi · Zuni Café — anything Qloo knows.
      </p>

      {searching ? <p className="text-xs text-muted">Searching Qloo…</p> : null}
      {error !== null ? <p className="text-xs text-danger">{error}</p> : null}
      {results !== null && !searching && results.length === 0 ? (
        <p className="text-xs text-muted">No matches — try another name.</p>
      ) : null}

      {results !== null && !searching && results.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
          {results.map((entity) => (
            <li key={entity.entityId} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{entity.name}</p>
                {entity.disambiguation ? (
                  <p className="truncate text-[11px] text-muted">{entity.disambiguation}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {shortSubtype(entity.subtype)}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleAdd(entity)}
                className="shrink-0 rounded border border-line px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default EntityPicker;
