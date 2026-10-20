import type { BackgroundReply, ContentMessage, ExternalMessage } from "./api";
import { FOCAL_ORIGIN } from "./config";
import { parseSettings } from "./settings";
import { getSession, setSession, setSettings, setTabResult } from "./storage";

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

chrome.runtime.onMessage.addListener((msg: ContentMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "identify":
      void post("/api/page/identify", msg.body).then(sendResponse);
      return true;
    case "rank":
      void post("/api/page/rank", msg.body).then(sendResponse);
      return true;
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
      void setSession({ token: msg.token, email: msg.email, savedAt: new Date().toISOString() }).then(() =>
        sendResponse({ ok: true }),
      );
      return true;
    case "focal:signout":
      void setSession(null).then(() => sendResponse({ ok: true }));
      return true;
    case "focal:settings":
      void setSettings(parseSettings(msg.settings)).then(() => sendResponse({ ok: true }));
      return true;
    case "focal:ping":
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return false;
  }
  sendResponse({ ok: false, error: "bad_message" });
  return false;
});
