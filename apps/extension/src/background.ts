import type { BackgroundReply, ContentMessage, ExternalMessage } from "./api";
import { FOCAL_ORIGIN } from "./config";
import type { Settings } from "./settings";
import { getSession, getSettings, setSession, setSettings, setTabResult } from "./storage";

/** All server calls go from here; content scripts never call the API. */
async function post<T>(path: string, body: unknown): Promise<BackgroundReply<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "signed_out", status: 401 };
  try {
    const res = await fetch(`${FOCAL_ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: JSON.stringify(body),
    });
    if (res.status === 401) await setSession(null);
    if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
}

interface WireSite {
  hostname: string;
  mode: "skip" | "off" | "on";
}

/** Server owns site settings; the extension caches them (§4.1, §4.2). */
async function applyWireSites(sites: WireSite[]): Promise<void> {
  const local = await getSettings();
  const next: Settings = {
    ...local, // keep the local incognito flag
    skipSites: sites.filter((s) => s.mode === "skip").map((s) => s.hostname),
    siteOff: sites.filter((s) => s.mode === "off").map((s) => s.hostname),
  };
  await setSettings(next);
}

async function authed(path: string, init?: RequestInit): Promise<Response | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    const res = await fetch(`${FOCAL_ORIGIN}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${session.token}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
    });
    if (res.status === 401) {
      await setSession(null);
      return null;
    }
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Writes started locally win over a refresh already in flight. */
let lastLocalWrite = 0;

/** Pull /api/settings into the local cache; safe offline (cache stays). */
export async function refreshSettingsFromServer(): Promise<void> {
  const startedAt = Date.now();
  const res = await authed("/api/settings");
  if (!res || startedAt < lastLocalWrite) return;
  const body = (await res.json().catch(() => null)) as { sites?: WireSite[] } | null;
  if (startedAt < lastLocalWrite) return;
  if (Array.isArray(body?.sites)) await applyWireSites(body.sites);
}

/** Toolbar per-site toggle writes back a single-site row; mode null removes it. */
export async function setSiteOnServer(hostname: string, on: boolean): Promise<boolean> {
  lastLocalWrite = Date.now();
  const res = await authed("/api/settings", {
    method: "POST",
    body: JSON.stringify({ hostname, mode: on ? null : "off" }),
  });
  if (!res) return false;
  const body = (await res.json().catch(() => null)) as { sites?: WireSite[] } | null;
  if (Array.isArray(body?.sites)) await applyWireSites(body.sites);
  return true;
}

void refreshSettingsFromServer();
chrome.runtime.onStartup?.addListener(() => void refreshSettingsFromServer());

chrome.runtime.onMessage.addListener((msg: ContentMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "identify":
      void post("/api/page/identify", msg.body).then(sendResponse);
      return true;
    case "rank":
      void post("/api/page/rank", msg.body).then(sendResponse);
      return true;
    case "feedback":
      void post("/api/feedback", msg.body).then(sendResponse);
      return true;
    case "undo-event":
      void post(`/api/activity/${encodeURIComponent(msg.eventId)}/undo`, {}).then(sendResponse);
      return true;
    case "set-site":
      void setSiteOnServer(msg.hostname, msg.on).then((saved) => sendResponse({ ok: saved, data: undefined as never }));
      return true;
    case "settings-open":
      void refreshSettingsFromServer();
      return false;
    case "page-result":
      if (tabId !== undefined) void setTabResult(tabId, { pageResultId: msg.pageResultId, lifted: msg.lifted });
      return false;
    case "open-why":
      void chrome.tabs.create({ url: `${FOCAL_ORIGIN}/why/${encodeURIComponent(msg.pageResultId)}` });
      return false;
    default:
      return false;
  }
});

/** Session handoff: only the focal origin may talk to the extension. */
chrome.runtime.onMessageExternal.addListener((msg: ExternalMessage, sender, sendResponse) => {
  if (sender.origin !== FOCAL_ORIGIN) {
    sendResponse({ ok: false, error: "forbidden_origin" });
    return false;
  }
  switch (msg?.type) {
    case "focal:session":
      if (typeof msg.token !== "string" || !msg.token) break;
      void setSession({ token: msg.token, email: msg.email, savedAt: new Date().toISOString() })
        .then(() => refreshSettingsFromServer())
        .then(() => sendResponse({ ok: true }));
      return true;
    case "focal:signout":
      void setSession(null).then(() => sendResponse({ ok: true }));
      return true;
    case "focal:ping":
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return false;
  }
  sendResponse({ ok: false, error: "bad_message" });
  return false;
});
