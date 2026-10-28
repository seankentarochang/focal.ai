"use client";

import { Inspector } from "@/components/inspector/Inspector";
import type { DemoPage, RankResponse } from "@/lib/client/types";

interface RightRailProps {
  page: DemoPage;
  response: RankResponse | null;
  error: string | null;
  busy: boolean;
}

export function RightRail({ page, response, error, busy }: RightRailProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-[76px] lg:self-start">
      <Inspector page={page} response={response} error={error} busy={busy} />
    </div>
  );
}

export default RightRail;
