import { z } from "zod";

export const searchBodySchema = z.object({
  query: z.string().min(1).max(80),
  types: z.array(z.string()).optional(),
  location: z.string().optional(),
});

export const candidateSchema = z
  .object({
    clientId: z.string(),
    name: z.string(),
    locationText: z.string().optional(),
    url: z.string().optional(),
    originalIndex: z.number().int().min(0),
    sponsored: z.boolean().optional(),
  })
  .passthrough();

export const seedSchema = z.object({
  entityId: z.string(),
  name: z.string(),
  subtype: z.string(),
  disambiguation: z.string().optional(),
  polarity: z.enum(["like", "dislike"]),
  weight: z.number(),
  source: z.enum(["typed", "searched", "agent"]),
  addedAt: z.string(),
});

export const ruleSchema = z.object({
  kind: z.enum(["exclude", "collapse", "boost"]),
  match: z.object({
    tagId: z.string().optional(),
    brandId: z.string().optional(),
    flag: z.literal("sponsored").optional(),
  }),
  weight: z.number().optional(),
});

export const profileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  seeds: z.array(seedSchema),
  rules: z.array(ruleSchema).max(20),
});

export const rankBodySchema = z.object({
  pageId: z.string(),
  pageType: z.string(),
  locationQuery: z.string().optional(),
  containerId: z.string().optional(),
  candidates: z.array(candidateSchema).min(1).max(50),
  profile: profileSchema,
});

export type SearchBody = z.infer<typeof searchBodySchema>;
export type RankBody = z.infer<typeof rankBodySchema>;
