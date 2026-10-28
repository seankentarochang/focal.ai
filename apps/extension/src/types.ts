/**
 * Mirror of the declarative render plan in @focal-ai/core (`RenderOp` /
 * `RenderPlan`). Kept local so the extension bundle never pulls in core's
 * runtime dependencies; the server validates plans before sending them.
 */
export type Badge = "top-pick" | "good-match";

export type RenderOp =
  | { op: "reorder"; containerId: string; order: string[] }
  | { op: "collapse"; containerId: string; clientIds: string[]; label: string }
  | { op: "annotate"; containerId: string; clientId: string; text: string; badge?: Badge }
  | { op: "emphasize"; containerId: string; clientId: string; level: "high" }
  | { op: "hide"; containerId: string; clientIds: string[]; label: string };

export interface RenderPlan {
  id: string;
  pageId: string;
  createdAt: string;
  ops: RenderOp[];
  summary: {
    moved: number;
    collapsed: number;
    unresolved: number;
    avgMovement: number;
    lifted?: number;
  };
}

/** What the extension extracts from one card. Never full HTML. */
export interface CardSnapshot {
  clientId: string;
  snippets: string[];
}
