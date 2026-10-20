import type { BackgroundReply, ContentMessage, IdentifyResponse, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, type ApplyHandle } from "./apply/apply";
import { createGate } from "./apply/gate";
import { FOCAL_HOSTS } from "./config";
import { cityHints, detectList, snapshotCards } from "./detect/detect";
import { checkEligibility } from "./guards/eligibility";
import { getSettings } from "./storage";

function send<T>(msg: ContentMessage): Promise<BackgroundReply<T>> {
  return chrome.runtime.sendMessage(msg);
}

let current: ApplyHandle | null = null;

/** guards → list detection → identify → rank → apply (§4.1). */
async function run(): Promise<void> {
  const settings = await getSettings();
  const eligibility = checkEligibility({
    url: location.href,
    settings,
    incognito: chrome.extension.inIncognitoContext,
    focalHosts: FOCAL_HOSTS,
    document,
  });
  if (!eligibility.eligible) return;

  const list = detectList(document);
  if (!list) return;

  const gate = createGate(list.container as HTMLElement);
  const host = location.hostname.replace(/^www\./, "");
  const pattern = pathPattern(location.pathname);

  const identified = await send<IdentifyResponse>({
    type: "identify",
    body: { host, pathPattern: pattern, signature: list.signature, cityHints: cityHints(document), cards: snapshotCards(list) },
  });
  if (!identified.ok || !identified.data.isList || !identified.data.pageType || identified.data.items.length === 0) {
    gate.cancel();
    return;
  }

  const ranked = await send<RankResponse>({
    type: "rank",
    body: { host, pathPattern: pattern, pageType: identified.data.pageType, items: identified.data.items },
  });
  if (!ranked.ok || !ranked.data.plan) {
    gate.cancel();
    return;
  }
  const { plan, pageResultId } = ranked.data;
  gate.ready(() => {
    current?.undo();
    current = applyPlan(list, plan, {
      onWhy: pageResultId ? () => void send({ type: "open-why", pageResultId }) : undefined,
    });
    if (pageResultId) void send({ type: "page-result", pageResultId, lifted: current.lifted });
  });
}

void run();
