"use client";

import { addSeed, createEmptyProfile, removeSeed, type TasteProfile } from "@focal-ai/core";
import { clearProfile, exportProfileJson } from "@/lib/client/store";
import { EntityPicker } from "./EntityPicker";

function shortSubtype(subtype: string): string {
  const segments = subtype.split(":");
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : subtype;
}

interface ProfilePanelProps {
  profile: TasteProfile;
  onProfileChange: (profile: TasteProfile) => void;
}

export function ProfilePanel({ profile, onProfileChange }: ProfilePanelProps) {
  function handleExport() {
    const blob = new Blob([exportProfileJson(profile)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "focal-profile.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function handleClear() {
    if (!window.confirm("Clear your taste profile? This removes all seeds from this browser.")) {
      return;
    }
    onProfileChange(createEmptyProfile());
    clearProfile();
  }

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-4 lg:self-start">
      <header>
        <h2 className="text-sm font-semibold text-ink">Your taste</h2>
        <p className="mt-1 text-xs text-muted">
          Stored in this browser only. Only entity names and IDs are sent to Qloo.
        </p>
      </header>

      {profile.seeds.length === 0 ? (
        <p className="text-xs text-muted">
          Nothing yet — search an artist, a film, or a restaurant you love.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {profile.seeds.map((seed) => (
            <li
              key={seed.entityId}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pl-2.5 pr-1"
            >
              <span className="text-xs text-ink">{seed.name}</span>
              <span className="font-mono text-[10px] text-muted">{shortSubtype(seed.subtype)}</span>
              <button
                type="button"
                aria-label={`Remove ${seed.name}`}
                onClick={() => onProfileChange(removeSeed(profile, seed.entityId))}
                className="grid size-4 place-items-center rounded-full text-xs leading-none text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <EntityPicker onAdd={(seed) => onProfileChange(addSeed(profile, seed))} />

      <footer className="flex items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Clear
        </button>
      </footer>
    </section>
  );
}

export default ProfilePanel;
