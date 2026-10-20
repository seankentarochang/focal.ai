import { describe, expect, it, vi } from "vitest";
import { createEmptyProfileV2, type ActivityEvent, type ProfileV2 } from "@focal-ai/core";
import type { QlooClient, QlooEntity } from "@focal-ai/qloo";
import { runChat } from "@/lib/server/chat/agent";
import { createProviderChain, type CompleteFn, type ChatProvider } from "@/lib/server/chat/providers";
import { runTool, type ToolContext } from "@/lib/server/chat/tools";

const entity = (id: string, name: string, subtype: string, disambiguation?: string) =>
  ({ entityId: id, name, subtype, disambiguation }) as unknown as QlooEntity;

function fakeQloo(over: Partial<QlooClient> = {}): QlooClient {
  return {
    search: async ({ query }) => ({
      entities: query.toLowerCase() === "rintaro" ? [entity("Q-rin", "Rintaro", "urn:entity:place", "San Francisco")] : [],
      durationMs: 1,
      raw: null,
    }),
    searchTags: async () => ({ tags: [], raw: null }),
    insights: async () => ({ entities: [], durationMs: 1, raw: null }),
    getEntities: async () => ({ entities: [], raw: null }),
    ...over,
  } as QlooClient;
}

function ctx(qloo: QlooClient, start: ProfileV2 = createEmptyProfileV2()): ToolContext & { profile: () => ProfileV2 } {
  let profile = start;
  const events: ActivityEvent[] = [];
  return {
    qloo,
    events,
    getProfile: () => profile,
    commit: async (next) => {
      profile = next;
    },
    profile: () => profile,
  };
}

describe("chat tools enforce the write rules", () => {
  it("saves a single exact match with chat attribution", async () => {
    const c = ctx(fakeQloo());
    const res = (await runTool(c, "add_thing", { name: "rintaro", type: "place", strength: "love" })) as { saved: boolean };
    expect(res.saved).toBe(true);
    expect(c.profile().entries).toMatchObject([{ kind: "thing", qlooId: "Q-rin", strength: "love", source: "chat" }]);
    expect(c.events[0]).toMatchObject({ actor: "chat", action: "add" });
  });

  it("returns choices instead of guessing when the name is ambiguous", async () => {
    const qloo = fakeQloo({
      search: async () => ({
        entities: [entity("Q1", "Dune", "urn:entity:movie", "1984"), entity("Q2", "Dune", "urn:entity:movie", "2021")],
        durationMs: 1,
        raw: null,
      }),
    });
    const c = ctx(qloo);
    const res = (await runTool(c, "add_thing", { name: "Dune", type: "movie", strength: "like" })) as { saved: boolean; choices: unknown[] };
    expect(res.saved).toBe(false);
    expect(res.choices).toHaveLength(2);
    expect(c.profile().entries).toEqual([]);
    const picked = (await runTool(c, "add_thing", { name: "Dune", type: "movie", strength: "like", entity_id: "Q2" })) as { saved: boolean };
    expect(picked.saved).toBe(true);
    expect(c.profile().entries[0]).toMatchObject({ qlooId: "Q2", disambiguation: "2021" });
  });

  it("creates rules as pending", async () => {
    const c = ctx(fakeQloo({ searchTags: async () => ({ tags: [{ id: "urn:tag:chain", name: "Chain" }], raw: null }) }));
    const res = (await runTool(c, "propose_rule", { rule: "chain" })) as { status: string };
    expect(res.status).toBe("pending");
    expect(c.profile().entries[0]).toMatchObject({ kind: "rule", status: "pending", strength: "never" });
  });

  it("rejects invalid arguments", async () => {
    const c = ctx(fakeQloo());
    expect(await runTool(c, "add_thing", { name: "Rintaro", type: "restaurant", strength: "like" })).toMatchObject({ error: expect.any(String) });
  });
});

describe("runChat", () => {
  it("executes tool calls, then returns the model's reply and the events", async () => {
    const replies = [
      { tool_calls: [{ id: "t1", type: "function" as const, function: { name: "add_thing", arguments: '{"name":"Rintaro","type":"place","strength":"love"}' } }] },
      { content: "Saved Rintaro as a love. What films do you like?" },
    ];
    const complete: CompleteFn = vi.fn(async () => ({ provider: "fake", message: { role: "assistant" as const, content: null, ...replies.shift() } }));
    let stored = createEmptyProfileV2();
    const res = await runChat([{ role: "user", content: "I love Rintaro" }], {
      complete,
      qloo: fakeQloo(),
      loadProfile: async () => stored,
      commit: async (next) => {
        stored = next;
      },
    });
    expect(res.reply).toMatch(/Saved Rintaro/);
    expect(res.events).toHaveLength(1);
    expect(stored.entries).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe("provider chain", () => {
  const providers: ChatProvider[] = [
    { name: "groq", baseUrl: "https://g", apiKey: "a", model: "m" },
    { name: "cerebras", baseUrl: "https://c", apiKey: "b", model: "m" },
  ];

  it("fails over on 429 to the next provider", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://g")
        ? new Response("slow down", { status: 429 })
        : Response.json({ choices: [{ message: { role: "assistant", content: "hi" } }] }),
    );
    const res = await createProviderChain(providers, fetchImpl as unknown as typeof fetch)([], []);
    expect(res.provider).toBe("cerebras");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not fail over on a 400 (bad request is our bug)", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(createProviderChain(providers, fetchImpl as unknown as typeof fetch)([], [])).rejects.toThrow("groq: HTTP 400");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
