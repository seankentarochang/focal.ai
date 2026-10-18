import { describe, expect, it } from "vitest";
import { parseIntent, type AgentIntent, type PolicyDirective } from "@/lib/server/agent/intent";

function policy(directives: PolicyDirective[]): AgentIntent {
  return { kind: "policy", directives };
}

describe("parseIntent — policy directives", () => {
  it("compiles 'boost <phrase>' into a boost-tag directive", () => {
    expect(parseIntent("boost natural wine")).toEqual(
      policy([{ op: "boost-tag", query: "natural wine" }]),
    );
  });

  it("compiles 'more like <phrase>' into a boost-tag directive", () => {
    expect(parseIntent("more like natural wine")).toEqual(
      policy([{ op: "boost-tag", query: "natural wine" }]),
    );
  });

  it("compiles 'favor <phrase>' into a boost-tag directive", () => {
    expect(parseIntent("favor jazz records")).toEqual(
      policy([{ op: "boost-tag", query: "jazz records" }]),
    );
  });

  it("compiles 'prioritize <phrase>' and maps bare 'chains' to the tag query 'chain'", () => {
    expect(parseIntent("prioritize chains")).toEqual(policy([{ op: "boost-tag", query: "chain" }]));
  });

  it("compiles 'exclude <phrase>' into an exclude-tag directive", () => {
    expect(parseIntent("exclude chains")).toEqual(
      policy([{ op: "exclude-tag", query: "chain" }]),
    );
  });

  it("compiles 'remove <phrase>' into an exclude-tag directive", () => {
    expect(parseIntent("remove ads")).toEqual(policy([{ op: "exclude-tag", query: "ads" }]));
  });

  it("compiles 'block <phrase>' into an exclude-tag directive", () => {
    expect(parseIntent("block street food")).toEqual(
      policy([{ op: "exclude-tag", query: "street food" }]),
    );
  });

  it("compiles 'without <phrase>' and trims trailing punctuation", () => {
    expect(parseIntent("without cigarette ads.")).toEqual(
      policy([{ op: "exclude-tag", query: "cigarette ads" }]),
    );
  });

  it("turns 'hide sponsored' into collapse-sponsored", () => {
    expect(parseIntent("hide sponsored")).toEqual(policy([{ op: "collapse-sponsored" }]));
  });

  it("turns a hide verb into collapse when the message mentions sponsors anywhere", () => {
    expect(parseIntent("This page shows sponsored results — hide the tabloid stuff")).toEqual(
      policy([{ op: "collapse-sponsored" }]),
    );
  });

  it("turns a boost whose phrase mentions sponsors into collapse-sponsored", () => {
    expect(parseIntent("boost sponsored labels")).toEqual(policy([{ op: "collapse-sponsored" }]));
  });

  it("strips trailing punctuation and connectors from the query", () => {
    expect(parseIntent("boost natural wine!!!")).toEqual(
      policy([{ op: "boost-tag", query: "natural wine" }]),
    );
  });

  it("parses multiple directives in message order", () => {
    expect(parseIntent("hide sponsored and boost natural wine")).toEqual(
      policy([{ op: "collapse-sponsored" }, { op: "boost-tag", query: "natural wine" }]),
    );
  });

  it("keeps order for 'boost ... and hide ...'", () => {
    expect(parseIntent("boost natural wine and hide sponsored")).toEqual(
      policy([{ op: "boost-tag", query: "natural wine" }, { op: "collapse-sponsored" }]),
    );
  });

  it("caps the query at 40 characters", () => {
    const intent = parseIntent("boost natural wine from the jura region of eastern france");
    expect(intent).toEqual(policy([{ op: "boost-tag", query: "natural wine from the jura region of eas" }]));
    if (intent.kind === "policy") {
      const [directive] = intent.directives;
      expect(directive?.op === "boost-tag" ? directive.query.length : 0).toBeLessThanOrEqual(40);
    }
  });

  it("matches verbs case-insensitively", () => {
    expect(parseIntent("BOOST Natural Wine")).toEqual(
      policy([{ op: "boost-tag", query: "Natural Wine" }]),
    );
  });

  it("removes duplicate directives", () => {
    expect(parseIntent("hide sponsored and hide sponsored")).toEqual(
      policy([{ op: "collapse-sponsored" }]),
    );
  });

  it("falls through to rank when a stray verb has no phrase", () => {
    expect(parseIntent("boost")).toEqual({ kind: "rank" });
  });
});

describe("parseIntent — fallback intents", () => {
  it("discovers on find", () => {
    expect(parseIntent("find me a cafe")).toEqual({ kind: "discovery" });
  });

  it("discovers on 'what should'", () => {
    expect(parseIntent("what should I try tonight")).toEqual({ kind: "discovery" });
  });

  it("explains on 'why'", () => {
    expect(parseIntent("why is this ranked here?")).toEqual({ kind: "explain" });
  });

  it("explains on 'reason'", () => {
    expect(parseIntent("give me the reason for this order")).toEqual({ kind: "explain" });
  });

  it("ranks by default", () => {
    expect(parseIntent("rank this page")).toEqual({ kind: "rank" });
  });

  it("prefers discovery over explain when both appear", () => {
    expect(parseIntent("explain where these matches come from")).toEqual({ kind: "discovery" });
  });
});
