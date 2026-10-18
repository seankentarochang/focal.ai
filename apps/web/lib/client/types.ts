import type { PageCandidate, RankedCandidate, RenderPlan, TasteProfile } from "@focal-ai/core";
import type { DataSource, QlooEntity } from "@focal-ai/qloo";

export type PageId = "tables" | "atlas" | "verve";
export type SurfaceMode = "original" | "focal" | "diff";

export interface DemoCandidate extends PageCandidate {
  blurb: string;   // one neutral, fictionalized line of copy
  meta: string;    // one-line meta, e.g. "Izakaya · Mission · $$"
}

export interface DemoPage {
  id: PageId;
  name: string;
  kind: string;              // e.g. "Restaurant directory — San Francisco"
  type: string;              // Qloo entity URN, e.g. "urn:entity:place"
  locationQuery?: string;    // e.g. "San Francisco"
  containerId: string;       // "focal:results"
  candidates: DemoCandidate[];
}

export interface RankMeta {
  dataSource: DataSource;
  durationMs: number;
  unresolved: number;
  qlooRequest: { path: string; params: Record<string, string> };
}

export interface RankResponse {
  ranked: RankedCandidate[];
  plan: RenderPlan;
  meta: RankMeta;
}

export interface SearchResponse {
  entities: QlooEntity[];
  meta: { dataSource: DataSource; durationMs: number };
}

export interface HealthResponse {
  ok: boolean;
  hasQlooKey: boolean;
  dataSource: DataSource;
}
