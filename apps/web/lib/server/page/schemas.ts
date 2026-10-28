import type { InsightType } from "@focal-ai/core";
import { z } from "zod";

/** Short type names used on the wire by the extension (apps/extension/src/api.ts). */
export const SHORT_TYPES = [
  "place", "destination", "movie", "tv_show", "book", "artist", "brand", "podcast", "videogame", "person",
] as const;
export type ShortType = (typeof SHORT_TYPES)[number];

export function toInsightType(t: ShortType): InsightType {
  return `urn:entity:${t}` as InsightType;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const host = z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9.-]+$/);

export const identifyBodySchema = z.object({
  host,
  pathPattern: z.string().max(300),
  signature: z.string().max(300),
  cityHints: z.array(text(80)).max(5),
  cards: z
    .array(
      z.object({
        clientId: text(16),
        snippets: z.array(text(80)).max(6),
      }),
    )
    .min(1)
    .max(60),
});
export type IdentifyBody = z.infer<typeof identifyBodySchema>;

export const identifiedItemSchema = z.object({
  clientId: text(16),
  name: text(200),
  type: z.enum(SHORT_TYPES),
  city: text(80).optional(),
});
export type IdentifiedItem = z.infer<typeof identifiedItemSchema>;

export const pageRankBodySchema = z.object({
  host,
  pageType: z.enum(SHORT_TYPES),
  items: z.array(identifiedItemSchema).min(1).max(60),
});
export type PageRankBody = z.infer<typeof pageRankBodySchema>;
