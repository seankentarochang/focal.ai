import { describe, expect, it } from "vitest";
import { buildPastePage, parsePastedList } from "@/lib/client/paste";

describe("parsePastedList", () => {
  it("splits on newlines, trims, and drops blank lines", () => {
    expect(parsePastedList(" Rintaro \n\n\t\nZuni Café\n  \n")).toEqual(["Rintaro", "Zuni Café"]);
  });

  it("strips common list prefixes", () => {
    expect(
      parsePastedList("1. Rintaro\n2) Zuni Café\n- Nari\n• Kin Khao\n* Che Fico\n3.Lazy Bear"),
    ).toEqual(["Rintaro", "Zuni Café", "Nari", "Kin Khao", "Che Fico", "Lazy Bear"]);
  });

  it("drops lines that are only a list prefix", () => {
    expect(parsePastedList("1.\n- \n•\nNari")).toEqual(["Nari"]);
  });

  it("keeps names that merely start with digits or a bullet character", () => {
    expect(parsePastedList("1908 Lisboa Hotel\n*NSYNC")).toEqual(["1908 Lisboa Hotel", "*NSYNC"]);
  });

  it("dedupes case-insensitively, keeping the first occurrence", () => {
    expect(parsePastedList("Nari\nnari\nNARI\nZuni Café")).toEqual(["Nari", "Zuni Café"]);
  });

  it("caps the list at 50 entries", () => {
    const text = Array.from({ length: 60 }, (_, index) => `Item ${index + 1}`).join("\n");
    const names = parsePastedList(text);
    expect(names).toHaveLength(50);
    expect(names[0]).toBe("Item 1");
    expect(names[49]).toBe("Item 50");
  });

  it("counts only kept entries toward the cap", () => {
    const lines = ["nari", ...Array.from({ length: 60 }, (_, index) => `Item ${index + 1}`)];
    const names = parsePastedList(lines.join("\n"));
    expect(names).toHaveLength(50);
    expect(names[0]).toBe("nari");
    expect(names[49]).toBe("Item 49");
  });

  it("returns an empty list for empty or whitespace-only input", () => {
    expect(parsePastedList("")).toEqual([]);
    expect(parsePastedList("\n \n\t")).toEqual([]);
  });
});

describe("buildPastePage", () => {
  it("builds the paste page shell", () => {
    const page = buildPastePage(["Rintaro", "Nari"], {
      type: "urn:entity:place",
      locationQuery: "Lisbon",
    });

    expect(page.id).toBe("paste");
    expect(page.name).toBe("Your list");
    expect(page.kind).toBe("Pasted list — 2 items");
    expect(page.type).toBe("urn:entity:place");
    expect(page.locationQuery).toBe("Lisbon");
    expect(page.containerId).toBe("focal:results");
  });

  it("maps names to candidates with paste- ids, indexes, and fields", () => {
    const page = buildPastePage(["Rintaro", "Nari"], {
      type: "urn:entity:place",
      locationQuery: "Lisbon",
    });

    expect(page.candidates).toEqual([
      {
        clientId: "paste-0",
        name: "Rintaro",
        originalIndex: 0,
        locationText: "Lisbon",
        blurb: "",
        meta: "",
      },
      {
        clientId: "paste-1",
        name: "Nari",
        originalIndex: 1,
        locationText: "Lisbon",
        blurb: "",
        meta: "",
      },
    ]);
    expect(page.candidates.every((candidate) => candidate.sponsored === undefined)).toBe(true);
  });

  it("omits the location when none is given", () => {
    const page = buildPastePage(["Rintaro"], { type: "urn:entity:artist" });

    expect(page.locationQuery).toBeUndefined();
    expect(page.candidates[0].locationText).toBeUndefined();
  });

  it("uses singular wording for a one-item list", () => {
    expect(buildPastePage(["Rintaro"], { type: "urn:entity:place" }).kind).toBe(
      "Pasted list — 1 item",
    );
  });
});
