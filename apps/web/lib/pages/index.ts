import type { DemoPage } from "../client/types";
import { ATLAS_PAGE } from "./atlas";
import { TABLES_PAGE } from "./tables";
import { VERVE_PAGE } from "./verve";

export type BuiltInPageId = "tables" | "atlas" | "verve";

export const BUILT_IN_PAGE_IDS = ["tables", "atlas", "verve"] as const satisfies readonly BuiltInPageId[];

export const PAGES: Record<BuiltInPageId, DemoPage> = {
  tables: TABLES_PAGE,
  atlas: ATLAS_PAGE,
  verve: VERVE_PAGE,
};

export function getPage(id: BuiltInPageId): DemoPage {
  return PAGES[id];
}
