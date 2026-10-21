import type { BackgroundReply, ContentMessage, IdentifyResponse, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, type ApplyHandle } from "./apply/apply";
import { createGate } from "./apply/gate";
import { FOCAL_HOSTS } from "./config";
import { cityHints, detectList, snapshotCards, type DetectedList } from "./detect/detect";
import { checkEligibility } from "./guards/eligibility";
import { getSettings } from "./storage";

function send<T>(msg: ContentMessage): Promise<BackgroundReply<T>> {
  return chrome.runtime.sendMessage(msg);
}

let current: ApplyHandle | null = null;
let watcher: MutationObserver | null = null;
let rerunTimer: ReturnType<typeof setTimeout> | undefined;
const runTimes: number[] = [];
let generation = 0;
let lastList: { container: Element; cards: Set<Element> } | null = null;

const RERUN_DELAY_MS = 1000;
const MAX_RUNS_PER_MINUTE = 6;

/** Sorting, infinite scroll and in-app navigation change the list after load; rank it again. */
function scheduleRerun(): void {
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    const now = Date.now();
    while (runTimes.length > 0 && now - runTimes[0]! > 60_000) runTimes.shift();
    if (runTimes.length >= MAX_RUNS_PER_MINUTE) return scheduleRerun();
    // Some apps change the URL before swapping the list; wait for the new cards.
    if (sameList(detectList(document))) return;
    watcher?.disconnect();
    watcher = null;
    current?.undo();
    current = null;
    void run(0);
  }, RERUN_DELAY_MS);
}

function sameList(list: DetectedList | null): boolean {
  if (!list || !lastList || list.container !== lastList.container || list.cards.size !== lastList.cards.size) return false;
  return [...list.cards.values()].every((el) => lastList!.cards.has(el));
}

function watch(container: Element, cards: Iterable<Element>): void {
  const known = new Set(cards);
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    const fresh = records.some((r) =>
      [...r.addedNodes].some((n) => n.nodeType === 1 && !known.has(n as Element) && !(n as Element).hasAttribute("data-focal")),
    );
    if (fresh || !container.isConnected) scheduleRerun();
  });
  watcher.observe(container, { childList: true });
  if (container.parentElement) watcher.observe(container.parentElement, { childList: true });
}

/** guards → list detection → identify → rank → apply (§4.1). */
async function run(gateMs?: number): Promise<void> {
  runTimes.push(Date.now());
  const gen = ++generation;
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
  lastList = { container: list.container, cards: new Set(list.cards.values()) };
  watch(list.container, list.cards.values());

  const gate = createGate(list.container as HTMLElement, gateMs);
  const host = location.hostname.replace(/^www\./, "");
  const pattern = pathPattern(location.pathname);

  const identified = await send<IdentifyResponse>({
    type: "identify",
    body: { host, pathPattern: pattern, signature: list.signature, cityHints: cityHints(document), cards: snapshotCards(list) },
  });
  if (gen !== generation || !identified.ok || !identified.data.isList || !identified.data.pageType || identified.data.items.length === 0) {
    gate.cancel();
    return;
  }

  const ranked = await send<RankResponse>({
    type: "rank",
    body: { host, pathPattern: pattern, pageType: identified.data.pageType, items: identified.data.items },
  });
  if (gen !== generation || !ranked.ok || !ranked.data.plan) {
    gate.cancel();
    return;
  }
  const { plan, pageResultId } = ranked.data;
  gate.ready(() => {
    if (gen !== generation) return;
    current?.undo();
    current = applyPlan(list, plan, {
      onWhy: pageResultId ? () => void send({ type: "open-why", pageResultId }) : undefined,
    });
    if (pageResultId) void send({ type: "page-result", pageResultId, lifted: current.lifted });
  });
}

let lastHref = location.href;
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  scheduleRerun();
}, 1000);

void run();
