import type { ActivityEvent, ProfileEntry } from "@focal-ai/core";

function strengthWord(entry: ProfileEntry): string {
  if (entry.kind === "rule") return "never";
  return entry.strength;
}

/** One-line, user-facing summary of a profile change the chat agent made. */
export function describeEvent(event: ActivityEvent): string {
  const entry = event.after ?? event.before;
  if (!entry) return "Profile updated";
  const name = entry.name;
  if (entry.kind === "rule" && event.action === "add") return `Rule “never ${name}” saved, pending your approval`;
  switch (event.action) {
    case "add":
      return `Saved ${name} · ${strengthWord(entry)}`;
    case "remove":
      return `Removed ${name}`;
    case "change":
      return `Updated ${name} · ${strengthWord(entry)}`;
    case "approve":
      return `Approved rule “never ${name}”`;
    case "undo":
      return `Undid change to ${name}`;
  }
}
