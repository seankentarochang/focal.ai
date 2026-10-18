import type { DemoPage } from "./types";

export const MAX_PASTE_ITEMS = 50;

const LIST_PREFIX_RE = /^\s*(?:\d+[.)]\s*|[-•*](?:\s+|$))/;

export function parsePastedList(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const rawLine of text.split("\n")) {
    const name = rawLine.trim().replace(LIST_PREFIX_RE, "").trim();
    if (name.length === 0) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);

    if (names.length === MAX_PASTE_ITEMS) break;
  }

  return names;
}

export function buildPastePage(
  names: string[],
  opts: { type: string; locationQuery?: string },
): DemoPage {
  return {
    id: "paste",
    name: "Your list",
    kind: `Pasted list — ${names.length} item${names.length === 1 ? "" : "s"}`,
    type: opts.type,
    locationQuery: opts.locationQuery,
    containerId: "focal:results",
    candidates: names.map((name, index) => ({
      clientId: `paste-${index}`,
      name,
      originalIndex: index,
      locationText: opts.locationQuery,
      blurb: "",
      meta: "",
    })),
  };
}
