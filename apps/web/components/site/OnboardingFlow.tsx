"use client";

import { useEffect, useState } from "react";
import type { ProfileEntry } from "@focal-ai/core";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ConnectExtension } from "@/components/connect/ConnectExtension";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tryNowLinks, type TryLink } from "@/lib/onboarding";

type Site = { hostname: string; mode: "skip" | "off" | "on" };

const HOST_RE = /^[a-z0-9.-]+$/;

function SitesStep() {
  const [sites, setSites] = useState<Site[]>([]);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : { sites: [] }))
      .then((d: { sites: Site[] }) => setSites(d.sites))
      .catch(() => undefined);
  }, []);

  const save = async (next: Site[]) => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sites: next }),
      });
      if (res.ok) setSites(((await res.json()) as { sites: Site[] }).sites);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {sites.map((s) => (
          <li key={s.hostname} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{s.hostname}</span>
            <Badge variant="outline">{s.mode}</Badge>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void save(sites.filter((x) => x.hostname !== s.hostname))}>
              Remove
            </Button>
          </li>
        ))}
        {sites.length === 0 && <li className="text-sm text-muted-foreground">No sites yet — add any site focal should never touch.</li>}
      </ul>
      <div className="flex gap-2">
        <input
          className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
          placeholder="example.com"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !HOST_RE.test(host.trim().toLowerCase())}
          onClick={() => void save([...sites, { hostname: host.trim().toLowerCase(), mode: "skip" }])}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

/** W-01 onboarding: chat → sites to skip → connect the extension → try it now. */
export function OnboardingFlow({ email, extensionId }: { email: string; extensionId: string }) {
  const [entries, setEntries] = useState<ProfileEntry[] | null>(null);

  const refresh = () =>
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { entries?: ProfileEntry[] } | null) => d?.entries ?? null)
      .then(setEntries)
      .catch(() => null);

  useEffect(() => {
    void refresh();
  }, []);

  const hasEntries = (entries?.length ?? 0) > 0;
  const links = tryNowLinks(entries ?? []);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            1 · Teach focal what you like {hasEntries && <Badge>done</Badge>}
          </CardTitle>
          <CardDescription>Tell the agent a few things you love — it resolves them and writes your profile.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChatPanel email={email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Sites to skip</CardTitle>
          <CardDescription>focal never runs on these sites.</CardDescription>
        </CardHeader>
        <CardContent>
          <SitesStep />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3 · Install and connect the extension</CardTitle>
          <CardDescription>Chromium browsers only, for now.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectExtension extensionId={extensionId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">4 · Try it now</CardTitle>
          <CardDescription>
            {hasEntries ? "Public list pages matched to your profile." : "Finish step 1 and we'll match public list pages to your profile."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {links.map((l: TryLink) => (
            <a key={l.url} className="text-sm underline" href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
          <Button variant="outline" size="sm" className="self-start" onClick={() => void refresh()}>
            Refresh links
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
