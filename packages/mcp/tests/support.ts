/**
 * Shared fixtures for the MCP tests. Entity ids and names come from
 * packages/qloo/fixtures/ so the mock client resolves them.
 */
import { writeFileSync } from "node:fs";
import { serializeProfile, type TasteProfile, type TasteSeed } from "@focal-ai/core";

export const FUGAZI_ENTITY_ID = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
export const RINTARO_ENTITY_ID = "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01";
export const STATE_BIRD_ENTITY_ID = "9C4D7E12-5F38-4A61-B7C0-2D8F1E5A9B42";

export const FUGAZI_SEED: TasteSeed = {
  entityId: FUGAZI_ENTITY_ID,
  name: "Fugazi",
  subtype: "urn:entity:artist",
  disambiguation: "Washington, D.C.",
  polarity: "like",
  weight: 1,
  source: "searched",
  addedAt: "2026-10-18T00:00:00.000Z",
};

export function fixtureProfile(): TasteProfile {
  return {
    version: 1,
    updatedAt: "2026-10-18T00:00:00.000Z",
    seeds: [{ ...FUGAZI_SEED }],
    rules: [],
  };
}

export function writeProfileFile(path: string, profile: TasteProfile): string {
  writeFileSync(path, serializeProfile(profile));
  return path;
}

export const CANDIDATES = [
  { clientId: "c-0", name: "Rintaro", locationText: "San Francisco", originalIndex: 0 },
  { clientId: "c-1", name: "State Bird", locationText: "San Francisco", originalIndex: 1 },
  {
    clientId: "c-2",
    name: "Definitely Not A Restaurant",
    locationText: "San Francisco",
    originalIndex: 2,
  },
];
