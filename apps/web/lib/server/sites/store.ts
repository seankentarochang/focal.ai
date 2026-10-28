import type { SiteSetting } from "@focal-ai/db";

const memory = new Map<string, SiteSetting[]>();

/** Dev-only site settings — cleared on account delete (R9-2). */
export function memorySites(userId: string): SiteSetting[] {
  return memory.get(userId) ?? [];
}
export function setMemorySites(userId: string, sites: SiteSetting[]): void {
  memory.set(userId, sites);
}
export function clearMemorySites(userId: string): void {
  memory.delete(userId);
}
