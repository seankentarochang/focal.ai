/**
 * Profile v2 (spec §4.5, §5.8–5.10): things, vibes and hard rules with
 * strength and source, plus the activity log that makes every write
 * attributable and undoable.
 *
 * Every operation is pure: it returns the next profile and the ActivityEvent
 * describing the change. Storage (Postgres) and transport (API, chat, MCP)
 * live outside this package and call these functions so the rules are the
 * same for every writer.
 */
import { z } from "zod";
import type { TasteProfile } from "./types";

export const INSIGHT_TYPES = [
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:videogame",
] as const;

export type InsightType = (typeof INSIGHT_TYPES)[number];

export type Strength = "love" | "like" | "dislike";

/** `chat` (website agent), `mcp:<client>` (outside assistant), `page` (on-page tap), `manual` (profile page). */
export type EntrySource = "chat" | "page" | "manual" | `mcp:${string}`;

export type RuleStatus = "pending" | "active";

interface EntryBase {
  id: string;
  /** Qloo entity id for things, tag URN for vibes and rules. */
  qlooId: string;
  name: string;
  source: EntrySource;
  createdAt: string;
}

export interface ThingEntry extends EntryBase {
  kind: "thing";
  type: InsightType;
  disambiguation?: string;
  strength: Strength;
}

export interface VibeEntry extends EntryBase {
  kind: "vibe";
  /** Insight types the vibe applies to; omitted means every type. */
  types?: InsightType[];
  strength: Strength;
}

export interface RuleEntry extends EntryBase {
  kind: "rule";
  strength: "never";
  status: RuleStatus;
}

export type ProfileEntry = ThingEntry | VibeEntry | RuleEntry;

export interface ProfileV2 {
  version: 2;
  updatedAt: string;
  entries: ProfileEntry[];
}

export type ActivityAction = "add" | "remove" | "change" | "approve" | "undo";

export interface ActivityEvent {
  id: string;
  /** Same vocabulary as EntrySource; `system` for migrations. */
  actor: EntrySource | "system";
  action: ActivityAction;
  entryId: string;
  /** Entry before the change (absent for add). */
  before?: ProfileEntry;
  /** Entry after the change (absent for remove). */
  after?: ProfileEntry;
  /** For `undo` events: the event that was undone. */
  undoes?: string;
  at: string;
}

export interface ProfileWrite {
  profile: ProfileV2;
  /** Null when the write changed nothing — callers skip the commit. */
  event: ActivityEvent | null;
}

export class ProfileError extends Error {
  code: "NOT_FOUND" | "INVALID" | "NOT_UNDOABLE";

  constructor(code: ProfileError["code"], message: string) {
    super(message);
    this.name = "ProfileError";
    this.code = code;
  }
}

export interface ProfileClock {
  now?: () => string;
  newId?: () => string;
}

function clock(c: ProfileClock | undefined) {
  return {
    now: c?.now ?? (() => new Date().toISOString()),
    newId: c?.newId ?? (() => crypto.randomUUID()),
  };
}

const insightTypeSchema = z.enum(INSIGHT_TYPES);
const sourceSchema = z.union([
  z.enum(["chat", "page", "manual"]),
  z.string().regex(/^mcp:[\w.-]{1,64}$/) as z.ZodType<`mcp:${string}`>,
]);
const baseShape = {
  id: z.string().min(1),
  qlooId: z.string().min(1),
  name: z.string().min(1).max(200),
  source: sourceSchema,
  createdAt: z.string(),
};

export const thingEntrySchema = z.object({
  ...baseShape,
  kind: z.literal("thing"),
  type: insightTypeSchema,
  disambiguation: z.string().max(300).optional(),
  strength: z.enum(["love", "like", "dislike"]),
});

export const vibeEntrySchema = z.object({
  ...baseShape,
  kind: z.literal("vibe"),
  types: z.array(insightTypeSchema).optional(),
  strength: z.enum(["love", "like", "dislike"]),
});

export const ruleEntrySchema = z.object({
  ...baseShape,
  kind: z.literal("rule"),
  strength: z.literal("never"),
  status: z.enum(["pending", "active"]),
});

export const profileEntrySchema = z.discriminatedUnion("kind", [
  thingEntrySchema,
  vibeEntrySchema,
  ruleEntrySchema,
]);

export const profileV2Schema = z.object({
  version: z.literal(2),
  updatedAt: z.string(),
  entries: z.array(profileEntrySchema),
});

export function createEmptyProfileV2(c?: ProfileClock): ProfileV2 {
  return { version: 2, updatedAt: clock(c).now(), entries: [] };
}

export function parseProfileV2(raw: unknown): ProfileV2 {
  const parsed = profileV2Schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ProfileError("INVALID", `Invalid profile: ${detail}`);
  }
  return parsed.data as ProfileV2;
}

/** Entries are unique per (kind, qlooId): one opinion per thing, vibe or rule. */
export function findEntry(
  profile: ProfileV2,
  kind: ProfileEntry["kind"],
  qlooId: string,
): ProfileEntry | undefined {
  return profile.entries.find((e) => e.kind === kind && e.qlooId === qlooId);
}

export type NewEntry =
  | Omit<ThingEntry, "id" | "createdAt">
  | Omit<VibeEntry, "id" | "createdAt">
  | Omit<RuleEntry, "id" | "createdAt" | "status" | "strength">;

/**
 * Add an entry, or change it when the same (kind, qlooId) already exists.
 *
 * Rules added by an agent (`chat` or `mcp:*`) start `pending` and only take
 * effect after approveRule; rules added from the website (`manual`) are active
 * immediately. Re-adding an identical entry still returns an event so callers
 * can confirm, but the profile is unchanged.
 */
export function addEntry(
  profile: ProfileV2,
  input: NewEntry,
  actor: EntrySource,
  c?: ProfileClock,
): ProfileWrite {
  const { now, newId } = clock(c);
  const at = now();
  const existing = findEntry(profile, input.kind, input.qlooId);

  let next: ProfileEntry;
  if (input.kind === "rule") {
    const status: RuleStatus =
      existing?.kind === "rule" && existing.status === "active"
        ? "active"
        : actor === "manual"
          ? "active"
          : "pending";
    next = {
      ...input,
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? at,
      strength: "never",
      status,
    };
  } else {
    next = { ...input, id: existing?.id ?? newId(), createdAt: existing?.createdAt ?? at } as ProfileEntry;
  }
  const checked = profileEntrySchema.safeParse(next);
  if (!checked.success) {
    throw new ProfileError("INVALID", `Invalid entry: ${checked.error.issues[0]?.message ?? "unknown"}`);
  }

  if (existing && JSON.stringify(existing) === JSON.stringify(next)) {
    return { profile, event: null };
  }

  const entries = existing
    ? profile.entries.map((e) => (e.id === existing.id ? next : e))
    : [...profile.entries, next];

  return {
    profile: { ...profile, updatedAt: at, entries },
    event: {
      id: newId(),
      actor,
      action: existing ? "change" : "add",
      entryId: next.id,
      ...(existing ? { before: existing } : {}),
      after: next,
      at,
    },
  };
}

export function removeEntry(
  profile: ProfileV2,
  entryId: string,
  actor: EntrySource,
  c?: ProfileClock,
): ProfileWrite {
  const { now, newId } = clock(c);
  const existing = profile.entries.find((e) => e.id === entryId);
  if (!existing) throw new ProfileError("NOT_FOUND", `No profile entry ${entryId}`);
  const at = now();
  return {
    profile: { ...profile, updatedAt: at, entries: profile.entries.filter((e) => e.id !== entryId) },
    event: { id: newId(), actor, action: "remove", entryId, before: existing, at },
  };
}

export function changeStrength(
  profile: ProfileV2,
  entryId: string,
  strength: Strength,
  actor: EntrySource,
  c?: ProfileClock,
): ProfileWrite {
  const { now, newId } = clock(c);
  const existing = profile.entries.find((e) => e.id === entryId);
  if (!existing) throw new ProfileError("NOT_FOUND", `No profile entry ${entryId}`);
  if (existing.kind === "rule") {
    throw new ProfileError("INVALID", "Rules have no strength; remove the rule instead");
  }
  if (existing.strength === strength) return { profile, event: null };
  const at = now();
  const next: ProfileEntry = { ...existing, strength };
  return {
    profile: {
      ...profile,
      updatedAt: at,
      entries: profile.entries.map((e) => (e.id === entryId ? next : e)),
    },
    event: { id: newId(), actor, action: "change", entryId, before: existing, after: next, at },
  };
}

/** Approve a pending rule. Only the website (`manual`) may approve. */
export function approveRule(
  profile: ProfileV2,
  entryId: string,
  c?: ProfileClock,
): ProfileWrite {
  const { now, newId } = clock(c);
  const existing = profile.entries.find((e) => e.id === entryId);
  if (!existing) throw new ProfileError("NOT_FOUND", `No profile entry ${entryId}`);
  if (existing.kind !== "rule") throw new ProfileError("INVALID", "Only rules can be approved");
  const at = now();
  const next: RuleEntry = { ...existing, status: "active" };
  return {
    profile: {
      ...profile,
      updatedAt: at,
      entries: profile.entries.map((e) => (e.id === entryId ? next : e)),
    },
    event: { id: newId(), actor: "manual", action: "approve", entryId, before: existing, after: next, at },
  };
}

/**
 * Undo a previous event by restoring the entry as it was before it. Undoing
 * an `undo` re-applies the original change. The restore is keyed by entry id,
 * so later unrelated writes are kept.
 */
export function undoEvent(
  profile: ProfileV2,
  event: ActivityEvent,
  actor: EntrySource,
  c?: ProfileClock,
): ProfileWrite {
  const { now, newId } = clock(c);
  const at = now();
  const current = profile.entries.find((e) => e.id === event.entryId);
  const restore = event.before;

  let entries: ProfileEntry[];
  if (restore === undefined) {
    if (!current) throw new ProfileError("NOT_UNDOABLE", "The entry is already gone");
    entries = profile.entries.filter((e) => e.id !== event.entryId);
  } else if (current) {
    entries = profile.entries.map((e) => (e.id === event.entryId ? restore : e));
  } else {
    const clash = findEntry(profile, restore.kind, restore.qlooId);
    if (clash) {
      throw new ProfileError("NOT_UNDOABLE", `"${restore.name}" was added again since; edit it instead`);
    }
    entries = [...profile.entries, restore];
  }

  return {
    profile: { ...profile, updatedAt: at, entries },
    event: {
      id: newId(),
      actor,
      action: "undo",
      entryId: event.entryId,
      ...(current ? { before: current } : {}),
      ...(restore ? { after: restore } : {}),
      undoes: event.id,
      at,
    },
  };
}

const STRENGTH_ORDER: Record<Strength, number> = { love: 0, like: 1, dislike: 2 };

/** Liked things, loves first, newest first within a strength. */
export function favouriteThings(profile: ProfileV2): ThingEntry[] {
  return profile.entries
    .filter((e): e is ThingEntry => e.kind === "thing" && e.strength !== "dislike")
    .sort(
      (a, b) =>
        STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

export function activeRules(profile: ProfileV2): RuleEntry[] {
  return profile.entries.filter((e): e is RuleEntry => e.kind === "rule" && e.status === "active");
}

/** Compact one-line-per-entry summary for chat context (§5.9 lean context). */
export function summarizeProfile(profile: ProfileV2): string {
  const lines: string[] = [];
  for (const e of profile.entries) {
    if (e.kind === "thing") lines.push(`${e.strength} thing "${e.name}" (${e.type.replace("urn:entity:", "")})`);
    else if (e.kind === "vibe") lines.push(`${e.strength} vibe "${e.name}"`);
    else lines.push(`${e.status} rule never "${e.name}"`);
  }
  return lines.length > 0 ? lines.join("\n") : "(empty profile)";
}

/**
 * Migrate a v1 (Studio, localStorage) profile. Like seeds become `like`
 * things (weight >= 1.5 becomes `love`), dislikes stay dislikes; v1 rules
 * with a tag become active rules (exclude/collapse) or liked vibes (boost).
 */
export function migrateProfileV1(v1: TasteProfile, c?: ProfileClock): ProfileV2 {
  const { now, newId } = clock(c);
  const entries: ProfileEntry[] = [];
  for (const seed of v1.seeds) {
    const type = insightTypeSchema.safeParse(seed.subtype);
    if (!type.success) continue;
    entries.push({
      id: newId(),
      kind: "thing",
      qlooId: seed.entityId,
      name: seed.name,
      type: type.data,
      ...(seed.disambiguation !== undefined ? { disambiguation: seed.disambiguation } : {}),
      strength: seed.polarity === "dislike" ? "dislike" : seed.weight >= 1.5 ? "love" : "like",
      source: seed.source === "agent" ? "chat" : "manual",
      createdAt: seed.addedAt,
    });
  }
  for (const rule of v1.rules) {
    const tag = rule.match.tagId;
    if (!tag) continue;
    if (rule.kind === "boost") {
      entries.push({ id: newId(), kind: "vibe", qlooId: tag, name: tag, strength: "like", source: "manual", createdAt: v1.updatedAt });
    } else {
      entries.push({ id: newId(), kind: "rule", qlooId: tag, name: tag, strength: "never", status: "active", source: "manual", createdAt: v1.updatedAt });
    }
  }
  return { version: 2, updatedAt: now(), entries };
}
