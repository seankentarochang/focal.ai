import type { CardSnapshot, RenderPlan } from "./types";

/** Qloo's 10 insight types, short form (core `urn:entity:<type>`). */
export type InsightType =
  | "place" | "destination" | "movie" | "tv_show" | "book"
  | "artist" | "brand" | "podcast" | "videogame" | "person";

/** Sent only for a new layout: card snippets, never full HTML (§6). */
export interface IdentifyRequest {
  host: string;
  pathPattern: string;
  signature: string;
  cityHints: string[];
  cards: CardSnapshot[];
}

export interface IdentifiedItem {
  clientId: string;
  name: string;
  type: InsightType;
  city?: string;
}

/**
 * Structure-only layout the server learned (§5.3): which snippet holds the
 * name, the page type and which city hint supplies the city. Replayed locally
 * on later visits so no identify call is needed. Keep in sync with
 * apps/web/lib/server/page/layout.ts.
 */
export interface LearnedLayout {
  fingerprint: string;
  namePosition: { snippetIndex: number };
  type: InsightType;
  citySource: { hintIndex: number } | null;
}

export interface IdentifyResponse {
  isList: boolean;
  pageType: InsightType | null;
  items: IdentifiedItem[];
  layout?: LearnedLayout;
}

/** Known layouts send only names, type and city (§6). */
export interface RankRequest {
  host: string;
  pageType: InsightType;
  items: IdentifiedItem[];
}

export interface RankResponse {
  pageResultId: string | null;
  status: "ranked" | "no_signals" | "nothing_scored";
  plan: RenderPlan | null;
  resolvedCount?: number;
}

/** More like this / Not for me taps (X-08). */
export type FeedbackRequest = { pageResultId: string; clientId: string; verdict: "more" | "less" };

export interface FeedbackResponse {
  saved: boolean;
  entryId?: string;
  eventId: string | null;
}

export type ContentMessage =
  | { type: "identify"; body: IdentifyRequest }
  | { type: "rank"; body: RankRequest }
  | { type: "feedback"; body: FeedbackRequest }
  | { type: "undo-event"; eventId: string }
  | { type: "page-result"; pageResultId: string; lifted: number }
  | { type: "settings-open" }
  | { type: "open-why"; pageResultId: string }
  | { type: "set-site"; hostname: string; on: boolean };

export type BackgroundReply<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/** Messages the focal website may send through externally_connectable. */
export type ExternalMessage =
  | { type: "focal:session"; token: string; email?: string }
  | { type: "focal:signout" }
  | { type: "focal:ping" };

/**
 * Path with ids generalised so layouts can be shared without leaking
 * specifics: numeric or id-like segments become `:id`; query is dropped.
 */
export function pathPattern(pathname: string): string {
  const parts = pathname.split("/").map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || (/\d/.test(seg) && seg.length > 12)) return ":id";
    return seg.toLowerCase();
  });
  return parts.join("/") || "/";
}
