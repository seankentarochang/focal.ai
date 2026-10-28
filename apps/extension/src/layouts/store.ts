import type { LearnedLayout } from "../api";

export interface StoredLayout extends LearnedLayout {
  savedAt: string;
}

const STORAGE_KEY = "layouts";
const MAX_LAYOUTS = 200;

export const layoutKey = (host: string, pathPattern: string, signature: string): string =>
  `${host}|${pathPattern}|${signature}`;

export async function getLayout(key: string): Promise<StoredLayout | null> {
  const { layouts } = await chrome.storage.local.get(STORAGE_KEY);
  const entry = (layouts as Record<string, StoredLayout> | undefined)?.[key];
  return entry ?? null;
}

/** Saves a learned layout, dropping the oldest entries past the cap. */
export async function saveLayout(key: string, layout: LearnedLayout): Promise<void> {
  const { layouts } = await chrome.storage.local.get(STORAGE_KEY);
  const all: Record<string, StoredLayout> = {
    ...(layouts as Record<string, StoredLayout> | undefined),
    [key]: { ...layout, savedAt: new Date().toISOString() },
  };
  const keys = Object.keys(all);
  if (keys.length > MAX_LAYOUTS) {
    keys.sort((a, b) => Date.parse(all[a]!.savedAt) - Date.parse(all[b]!.savedAt));
    for (const old of keys.slice(0, keys.length - MAX_LAYOUTS)) delete all[old];
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
}
