/** Settings cached in chrome.storage so eligibility never needs the network. */
export interface Settings {
  /** Hosts the user skips (onboarding / settings page). */
  skipSites: string[];
  /** Hosts switched off from the toolbar. */
  siteOff: string[];
  /** Run in incognito windows. Off by default (§5.1). */
  incognito: boolean;
}

export const DEFAULT_SETTINGS: Settings = { skipSites: [], siteOff: [], incognito: false };

/** Lower-cases a host or URL-ish string and drops `www.`, port and path. */
export function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, "").replace(/\.$/, "");
  return s.replace(/^www\./, "");
}

/** True when `host` equals `site` or is a subdomain of it. */
export function hostMatches(host: string, site: string): boolean {
  const h = normalizeHost(host);
  const s = normalizeHost(site);
  if (!s) return false;
  return h === s || h.endsWith(`.${s}`);
}

export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hosts = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string").map(normalizeHost).filter(Boolean))]
      : [];
  return {
    skipSites: hosts(r.skipSites),
    siteOff: hosts(r.siteOff),
    incognito: r.incognito === true,
  };
}

export function toggleSite(settings: Settings, host: string, on: boolean): Settings {
  const h = normalizeHost(host);
  const rest = settings.siteOff.filter((s) => s !== h);
  return { ...settings, siteOff: on ? rest : [...rest, h] };
}
