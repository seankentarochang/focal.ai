import type { DemoPage, PageId } from "../client/types";
import { ATLAS_PAGE } from "./atlas";
import { TABLES_PAGE } from "./tables";
import { VERVE_PAGE } from "./verve";

export const PAGES: Record<PageId, DemoPage> = {
  tables: TABLES_PAGE,
  atlas: ATLAS_PAGE,
  verve: VERVE_PAGE,
};

export function getPage(id: PageId): DemoPage {
  return PAGES[id];
}
