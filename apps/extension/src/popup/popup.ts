import { FOCAL_HOSTS, FOCAL_ORIGIN } from "../config";
import { checkEligibility } from "../guards/eligibility";
import { normalizeHost, toggleSite } from "../settings";
import { getSession, getSettings, getTabResult, setSettings } from "../storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const REASON_TEXT: Record<string, string> = {
  scheme: "focal doesn't run on this page.",
  "never-run": "focal never runs on this kind of site.",
  skipped: "You skip this site in settings.",
  incognito: "focal is off in incognito.",
};

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const session = await getSession();
  const settings = await getSettings();
  $("dashboard").setAttribute("href", `${FOCAL_ORIGIN}/chat`);

  $("account").textContent = session ? `Signed in${session.email ? ` as ${session.email}` : ""}` : "Not signed in";
  if (!session) {
    const link = document.createElement("a");
    link.href = `${FOCAL_ORIGIN}/sign-in?from=extension`;
    link.target = "_blank";
    link.textContent = "Sign in";
    $("account").append(" · ", link);
  }

  void chrome.runtime.sendMessage({ type: "settings-open" });
  const url = tab?.url ?? "";
  const host = url ? normalizeHost(url) : "";
  const toggle = $<HTMLInputElement>("site-toggle");
  $("site-label").textContent = host ? `On for ${host}` : "This site";
  const check = checkEligibility({ url, settings: { ...settings, siteOff: [] }, incognito: !!tab?.incognito, focalHosts: FOCAL_HOSTS });
  if (!check.eligible) {
    toggle.disabled = true;
    toggle.checked = false;
    $("site-status").textContent = REASON_TEXT[check.reason.kind] ?? "";
  } else {
    toggle.checked = !settings.siteOff.includes(host);
    toggle.addEventListener("change", async () => {
      const on = toggle.checked;
      const revert = async (copy: string) => {
        await setSettings(toggleSite(await getSettings(), host, !on));
        toggle.checked = !on;
        $("site-status").textContent = copy;
      };
      await setSettings(toggleSite(await getSettings(), host, on));
      try {
        const res = (await chrome.runtime.sendMessage({ type: "set-site", hostname: host, on })) as { ok?: boolean } | undefined;
        if (!res?.ok) {
          // Server write failed: revert the local toggle so state stays honest.
          await revert("Couldn't save — change reverted");
          return;
        }
        if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
      } catch {
        await revert("Couldn't save — change reverted");
      }
    });
  }

  const result = tab?.id !== undefined ? await getTabResult(tab.id) : null;
  const why = $<HTMLButtonElement>("why");
  if (result) {
    why.disabled = false;
    why.addEventListener("click", () => {
      void chrome.tabs.create({ url: `${FOCAL_ORIGIN}/why/${encodeURIComponent(result.pageResultId)}` });
    });
  }
}

void main();
