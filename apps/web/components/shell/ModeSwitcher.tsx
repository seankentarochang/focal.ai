"use client";

import type { SurfaceMode } from "@/lib/client/types";

export const MODE_OPTIONS: { id: SurfaceMode; title: string }[] = [
  { id: "original", title: "Original" },
  { id: "focal", title: "Focal" },
  { id: "diff", title: "Diff" },
];

interface ModeSwitcherProps {
  mode: SurfaceMode;
  onChange: (mode: SurfaceMode) => void;
  disabled: boolean;
}

export function ModeSwitcher({ mode, onChange, disabled }: ModeSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Surface mode"
      aria-disabled={disabled}
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 ${
        disabled ? "opacity-40" : ""
      }`}
    >
      {MODE_OPTIONS.map((option) => {
        const active = mode === option.id;
        const state = active
          ? "bg-accent-soft text-ink"
          : disabled
            ? "cursor-not-allowed text-muted"
            : "text-muted hover:text-ink";
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${state}`}
          >
            {option.title}
          </button>
        );
      })}
    </div>
  );
}

export default ModeSwitcher;
