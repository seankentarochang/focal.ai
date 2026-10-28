import type { LearnedLayout } from "../api";

export interface StoredLayout extends LearnedLayout {
  savedAt: string;
}

const STORAGE_KEY = "layouts";
const MAX_LAYOUTS = 200;
/** Layouts rot with redesigns: a stale mapping misidentifies silently. */
export const LAYOUT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const layoutKey = (host: string, pathPattern: string, signature: string): string =>
  `${host}|${pathPattern}|${signature}`;

export async function getLayout(key: string): Promise<StoredLayout | null> {
  const { layouts } = await chrome.storage.local.get(STORAGE_KEY);
  const entry = (layouts as Record<string, StoredLayout> | undefined)?.[key];
  if (!entry) return null;
  if (Date.now() - Date.parse(entry.savedAt) > LAYOUT_TTL_MS) {
    await deleteLayout(key);
    return null;
  }
  return entry;
}

export async function deleteLayout(key: string): Promise<void> {
  const { layouts } = await chrome.storage.local.get(STORAGE_KEY);
  const all = { ...(layouts as Record<string, StoredLayout> | undefined) };
  delete all[key];
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
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
