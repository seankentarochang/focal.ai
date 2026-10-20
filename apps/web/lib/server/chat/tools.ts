import {
  addEntry,
  removeEntry,
  summarizeProfile,
  type ActivityEvent,
  type InsightType,
  type ProfileV2,
} from "@focal-ai/core";
import type { QlooClient, QlooEntityType } from "@focal-ai/qloo";
import type { ToolSpec } from "./providers";

const TYPES = ["place", "destination", "movie", "tv_show", "book", "artist", "brand", "podcast", "videogame", "person"] as const;
const STRENGTHS = ["love", "like", "dislike"] as const;

export const CHAT_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "search_entities",
      description: "Find real-world things (venues, films, artists…) by name. Use before adding when unsure.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, type: { type: "string", enum: TYPES }, city: { type: "string" } },
        required: ["query", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_thing",
      description:
        "Save a thing the user likes, loves or dislikes. Saves only on one clear match; otherwise returns choices to ask the user about. Pass entity_id when the user picked one of the choices.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: TYPES },
          strength: { type: "string", enum: STRENGTHS },
          city: { type: "string" },
          entity_id: { type: "string" },
        },
        required: ["name", "type", "strength"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_vibe",
      description: "Save a vibe (a style or quality like 'natural wine' or 'minimalist') the user likes or dislikes.",
      parameters: {
        type: "object",
        properties: { vibe: { type: "string" }, strength: { type: "string", enum: STRENGTHS }, tag_id: { type: "string" } },
        required: ["vibe", "strength"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_rule",
      description: "Propose a hard rule ('never show me chains'). It stays pending until the user approves it on the website.",
      parameters: {
        type: "object",
        properties: { rule: { type: "string" }, tag_id: { type: "string" } },
        required: ["rule"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_entry",
      description: "Remove something from the profile by name.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  {
    type: "function",
    function: { name: "read_profile", description: "Read the user's current taste profile.", parameters: { type: "object", properties: {} } },
  },
];

export interface ToolContext {
  qloo: QlooClient;
  getProfile(): ProfileV2;
  /** Persists one write; throws on conflict. */
  commit(next: ProfileV2, event: ActivityEvent): Promise<void>;
  events: ActivityEvent[];
}

export const normalizeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const toType = (t: string): InsightType => `urn:entity:${t}` as InsightType;
type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function save(ctx: ToolContext, input: Parameters<typeof addEntry>[1]) {
  const { profile, event } = addEntry(ctx.getProfile(), input, "chat");
  await ctx.commit(profile, event);
  ctx.events.push(event);
  return event;
}

async function resolveTag(ctx: ToolContext, query: string, tagId?: string) {
  const { tags } = await ctx.qloo.searchTags({ query, take: 5 });
  if (tagId) {
    const picked = tags.find((t) => t.id === tagId);
    return picked ? { match: picked } : { choices: tags };
  }
  const exact = tags.filter((t) => normalizeName(t.name) === normalizeName(query));
  return exact.length === 1 ? { match: exact[0]! } : { choices: tags };
}

/** Executes one tool call. Write rules live here, not in the prompt (§5.9). */
export async function runTool(ctx: ToolContext, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "search_entities": {
      const query = str(args.query);
      const type = str(args.type);
      if (!query || !type || !TYPES.includes(type as (typeof TYPES)[number])) return { error: "query and a valid type are required" };
      const { entities } = await ctx.qloo.search({ query, types: [toType(type) as QlooEntityType], location: str(args.city), take: 5 });
      return { results: entities.map((e) => ({ entity_id: e.entityId, name: e.name, disambiguation: e.disambiguation })) };
    }
    case "add_thing": {
      const thingName = str(args.name);
      const type = str(args.type);
      const strength = str(args.strength);
      if (!thingName || !type || !TYPES.includes(type as (typeof TYPES)[number]) || !STRENGTHS.includes(strength as (typeof STRENGTHS)[number])) {
        return { error: "name, a valid type and strength are required" };
      }
      const { entities } = await ctx.qloo.search({ query: thingName, types: [toType(type) as QlooEntityType], location: str(args.city), take: 5 });
      const ofType = entities.filter((e) => e.subtype === toType(type) || !e.subtype);
      const entityId = str(args.entity_id);
      const exact = entityId
        ? ofType.filter((e) => e.entityId === entityId)
        : ofType.filter((e) => normalizeName(e.name) === normalizeName(thingName));
      if (exact.length !== 1) {
        return {
          saved: false,
          reason: exact.length === 0 && !entityId ? "no exact match" : "ambiguous",
          choices: ofType.map((e) => ({ entity_id: e.entityId, name: e.name, disambiguation: e.disambiguation })),
          instruction: "Ask the user which one they mean, then call add_thing again with entity_id.",
        };
      }
      const e = exact[0]!;
      const event = await save(ctx, {
        kind: "thing",
        qlooId: e.entityId,
        name: e.name,
        type: toType(type),
        strength: strength as (typeof STRENGTHS)[number],
        source: "chat",
        ...(e.disambiguation ? { disambiguation: e.disambiguation } : {}),
      });
      return { saved: true, name: e.name, disambiguation: e.disambiguation, strength, event_id: event.id };
    }
    case "add_vibe":
    case "propose_rule": {
      const query = str(name === "add_vibe" ? args.vibe : args.rule);
      if (!query) return { error: "missing text" };
      const strength = name === "add_vibe" ? str(args.strength) : "never";
      if (name === "add_vibe" && !STRENGTHS.includes(strength as (typeof STRENGTHS)[number])) return { error: "invalid strength" };
      const found = await resolveTag(ctx, query, str(args.tag_id));
      if (!("match" in found) || !found.match) {
        return {
          saved: false,
          choices: found.choices.map((t) => ({ tag_id: t.id, name: t.name })),
          instruction: "Ask the user which one fits, then call again with tag_id.",
        };
      }
      const tag = found.match;
      const event =
        name === "add_vibe"
          ? await save(ctx, { kind: "vibe", qlooId: tag.id, name: tag.name, strength: strength as (typeof STRENGTHS)[number], source: "chat" })
          : await save(ctx, { kind: "rule", qlooId: tag.id, name: tag.name, source: "chat" });
      return name === "add_vibe"
        ? { saved: true, vibe: tag.name, strength, event_id: event.id }
        : { saved: true, rule: tag.name, status: "pending", note: "The user must approve this rule on their profile page.", event_id: event.id };
    }
    case "remove_entry": {
      const target = str(args.name);
      if (!target) return { error: "missing name" };
      const matches = ctx.getProfile().entries.filter((e) => normalizeName(e.name) === normalizeName(target));
      if (matches.length !== 1) return { removed: false, choices: matches.map((m) => ({ name: m.name, kind: m.kind })) };
      const { profile, event } = removeEntry(ctx.getProfile(), matches[0]!.id, "chat");
      await ctx.commit(profile, event);
      ctx.events.push(event);
      return { removed: true, name: matches[0]!.name, event_id: event.id };
    }
    case "read_profile":
      return { profile: summarizeProfile(ctx.getProfile()) || "empty" };
    default:
      return { error: `unknown tool ${name}` };
  }
}
