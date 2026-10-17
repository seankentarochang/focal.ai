import { describe, expect, it } from "vitest";
import {
  planRender,
  validatePlan,
  type RankedCandidate,
  type RenderPlan,
  type RenderOp,
} from "../src/index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rc(opts: {
  clientId: string;
  originalIndex: number;
  position: number;
  status?: RankedCandidate["status"];
  affinityPct?: number;
  sponsored?: boolean;
  ruleEffects?: RankedCandidate["ruleEffects"];
}): RankedCandidate {
  return {
    clientId: opts.clientId,
    name: opts.clientId,
    originalIndex: opts.originalIndex,
    position: opts.position,
    status: opts.status ?? "resolved",
    sponsored: opts.sponsored,
    affinityPct: opts.affinityPct,
    ruleEffects: opts.ruleEffects,
    entity:
      opts.status === undefined || opts.status === "resolved"
        ? { entityId: `e-${opts.clientId}`, name: opts.clientId, subtype: "urn:entity:place" }
        : undefined,
  };
}

function fixtureRanked(): RankedCandidate[] {
  return [
    rc({ clientId: "a", originalIndex: 0, position: 0, affinityPct: 94.2 }),
    rc({
      clientId: "c",
      originalIndex: 2,
      position: 1,
      affinityPct: 30,
      ruleEffects: [{ kind: "exclude", label: "you marked this as disliked" }],
    }),
    rc({ clientId: "d", originalIndex: 3, position: 2, status: "ambiguous" }),
    rc({ clientId: "b", originalIndex: 1, position: 3, affinityPct: 60, sponsored: true }),
    rc({ clientId: "e", originalIndex: 4, position: 4, status: "unresolved" }),
  ];
}

function makePlan(ops: unknown[]): RenderPlan {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    pageId: "test-page",
    createdAt: "2026-01-01T00:00:00.000Z",
    ops: ops as RenderOp[],
    summary: { moved: 0, collapsed: 0, unresolved: 0, avgMovement: 0 },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("planRender", () => {
  it("emits reorder first, containing EVERY candidate clientId in ranked order", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked() });
    expect(plan.ops[0]).toEqual({
      op: "reorder",
      containerId: "focal:results",
      order: ["a", "c", "d", "b", "e"],
    });
  });

  it("collapses sponsored candidates by default", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked() });
    const collapseOps = plan.ops.filter((op) => op.op === "collapse");
    expect(collapseOps[0]).toEqual({
      op: "collapse",
      containerId: "focal:results",
      clientIds: ["b"],
      label: "1 sponsored results collapsed",
    });
  });

  it("collapses candidates carrying dislike/exclude ruleEffects with the rules label", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked() });
    const collapseOps = plan.ops.filter((op) => op.op === "collapse");
    expect(collapseOps[1]).toEqual({
      op: "collapse",
      containerId: "focal:results",
      clientIds: ["c"],
      label: "1 hidden by your rules",
    });
  });

  it("skips the sponsored collapse when collapseSponsored is false", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked(), options: { collapseSponsored: false } });
    const collapseOps = plan.ops.filter((op) => op.op === "collapse");
    expect(collapseOps).toHaveLength(1);
    expect(collapseOps[0]).toMatchObject({ clientIds: ["c"], label: "1 hidden by your rules" });
    expect(plan.summary.collapsed).toBe(1);
  });

  it("annotates every resolved candidate with affinityPct in format '<pct>% match'", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked() });
    const annotateOps = plan.ops.filter((op) => op.op === "annotate");
    expect(annotateOps).toEqual([
      { op: "annotate", containerId: "focal:results", clientId: "a", text: "94.2% match" },
      { op: "annotate", containerId: "focal:results", clientId: "c", text: "30% match" },
      { op: "annotate", containerId: "focal:results", clientId: "b", text: "60% match" },
    ]);
  });

  it("skips annotate ops (but keeps the rest) when annotate is false", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked(), options: { annotate: false } });
    expect(plan.ops.some((op) => op.op === "annotate")).toBe(false);
    expect(plan.ops.some((op) => op.op === "emphasize")).toBe(true);
  });

  it("emphasizes resolved candidates at or above the default threshold of 85", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked() });
    expect(plan.ops.filter((op) => op.op === "emphasize")).toEqual([
      { op: "emphasize", containerId: "focal:results", clientId: "a", level: "high" },
    ]);
  });

  it("honors a custom emphasizeThreshold", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked(), options: { emphasizeThreshold: 50 } });
    expect(plan.ops.filter((op) => op.op === "emphasize")).toEqual([
      { op: "emphasize", containerId: "focal:results", clientId: "a", level: "high" },
      { op: "emphasize", containerId: "focal:results", clientId: "b", level: "high" },
    ]);
  });

  it("computes moved/collapsed/unresolved/avgMovement exactly", () => {
    const plan = planRender({ pageId: "tables", ranked: fixtureRanked() });
    expect(plan.summary).toEqual({ moved: 3, collapsed: 2, unresolved: 1, avgMovement: 0.8 });
  });

  it("uses a custom containerId on every op", () => {
    const plan = planRender({
      pageId: "tables",
      ranked: fixtureRanked(),
      options: { containerId: "focal:tables" },
    });
    expect(plan.ops.every((op) => op.containerId === "focal:tables")).toBe(true);
  });

  it("produces a UUID id, ISO createdAt, and the given pageId", () => {
    const plan = planRender({ pageId: "atlas", ranked: fixtureRanked() });
    expect(plan.id).toMatch(UUID_RE);
    expect(new Date(plan.createdAt).toISOString()).toBe(plan.createdAt);
    expect(plan.pageId).toBe("atlas");
  });

  it("has a deterministic structure and never mutates the input", () => {
    const ranked = deepFreeze(fixtureRanked());
    const planA = planRender({ pageId: "tables", ranked });
    const planB = planRender({ pageId: "tables", ranked });
    expect(planA.ops).toEqual(planB.ops);
    expect(planA.summary).toEqual(planB.summary);
    expect(ranked.map((r) => r.clientId)).toEqual(["a", "c", "d", "b", "e"]);
  });

  it("handles an empty page with zeroed summary and no invented ops", () => {
    const plan = planRender({ pageId: "empty", ranked: [] });
    expect(plan.ops).toEqual([{ op: "reorder", containerId: "focal:results", order: [] }]);
    expect(plan.summary).toEqual({ moved: 0, collapsed: 0, unresolved: 0, avgMovement: 0 });
  });

  it("passes its own output through validatePlan", () => {
    const result = validatePlan(planRender({ pageId: "tables", ranked: fixtureRanked() }));
    expect(result).toEqual({ ok: true });
  });
});

describe("validatePlan", () => {
  const goodOps = (): unknown[] => [
    { op: "reorder", containerId: "focal:results", order: ["a", "b"] },
    { op: "collapse", containerId: "focal:results", clientIds: ["b"], label: "1 sponsored results collapsed" },
    { op: "annotate", containerId: "focal:results", clientId: "a", text: "94.2% match" },
    { op: "emphasize", containerId: "focal:results", clientId: "a", level: "high" },
    { op: "hide", containerId: "focal:results", clientIds: ["b"], label: "1 hidden" },
  ];

  it("accepts a valid plan", () => {
    expect(validatePlan(makePlan(goodOps()))).toEqual({ ok: true });
  });

  it("rejects empty or missing ops", () => {
    const empty = validatePlan(makePlan([]));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.some((e) => e.includes("non-empty"))).toBe(true);
  });

  it("rejects unknown op values", () => {
    const result = validatePlan(makePlan([{ op: "frobnicate", containerId: "focal:results" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("unknown op"))).toBe(true);
  });

  it("rejects bad containerIds but accepts valid ones", () => {
    for (const bad of ["results", "focal:", "other:results", 42]) {
      const result = validatePlan(makePlan([{ op: "reorder", containerId: bad, order: ["a"] }]));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((e) => e.includes("containerId"))).toBe(true);
    }
    const ok = validatePlan(makePlan([{ op: "reorder", containerId: "Focal:My-Page-2", order: ["a"] }]));
    expect(ok).toEqual({ ok: true });
  });

  it("rejects empty reorder.order and empty collapse/hide clientIds", () => {
    const bad = validatePlan(
      makePlan([
        { op: "reorder", containerId: "focal:results", order: [] },
        { op: "collapse", containerId: "focal:results", clientIds: [], label: "0 collapsed" },
        { op: "hide", containerId: "focal:results", clientIds: [], label: "0 hidden" },
      ]),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.filter((e) => e.includes("non-empty array of strings"))).toHaveLength(3);
    }
  });

  it("rejects '<' in annotate text and text longer than 140 characters", () => {
    const html = validatePlan(
      makePlan([{ op: "annotate", containerId: "focal:results", clientId: "a", text: "<script>alert(1)</script>" }]),
    );
    expect(html.ok).toBe(false);
    if (!html.ok) expect(html.errors.some((e) => e.includes('"<"'))).toBe(true);

    const long = validatePlan(
      makePlan([{ op: "annotate", containerId: "focal:results", clientId: "a", text: "x".repeat(141) }]),
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.some((e) => e.includes("140"))).toBe(true);
  });

  it("accepts an annotate text of exactly 140 characters", () => {
    const boundary = validatePlan(
      makePlan([{ op: "annotate", containerId: "focal:results", clientId: "a", text: "x".repeat(140) }]),
    );
    expect(boundary).toEqual({ ok: true });
  });

  it("rejects emphasize levels other than 'high'", () => {
    const result = validatePlan(
      makePlan([{ op: "emphasize", containerId: "focal:results", clientId: "a", level: "low" }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('"high"'))).toBe(true);
  });

  it("enforces referential integrity against the reorder universe", () => {
    const result = validatePlan(
      makePlan([
        { op: "reorder", containerId: "focal:results", order: ["a", "b"] },
        { op: "annotate", containerId: "focal:results", clientId: "zz", text: "50% match" },
        { op: "collapse", containerId: "focal:results", clientIds: ["a", "yy"], label: "2 collapsed" },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('"zz"') && e.includes("unknown clientId"))).toBe(true);
      expect(result.errors.some((e) => e.includes('"yy"') && e.includes("unknown clientId"))).toBe(true);
    }
  });

  it("collects ALL violations instead of stopping at the first", () => {
    const result = validatePlan(
      makePlan([
        { op: "reorder", containerId: "focal:results", order: ["a"] },
        { op: "frobnicate", containerId: "nope", order: [] },
        { op: "annotate", containerId: "focal:results", clientId: "a", text: "<img src=x onerror=1>" },
        { op: "emphasize", containerId: "focal:results", clientId: "a", level: "medium" },
        { op: "collapse", containerId: "focal:results", clientIds: [], label: "" },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
      expect(result.errors.some((e) => e.includes("unknown op"))).toBe(true);
      expect(result.errors.some((e) => e.includes("containerId"))).toBe(true);
      expect(result.errors.some((e) => e.includes('"<"'))).toBe(true);
      expect(result.errors.some((e) => e.includes('"high"'))).toBe(true);
      expect(result.errors.some((e) => e.includes("non-empty array of strings"))).toBe(true);
    }
  });
});
