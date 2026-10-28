"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Site = { hostname: string; mode: "skip" | "off" };

/** Built-in never-run categories (mirrors extension neverRun.ts; don't import it). */
const NEVER_RUN = ["banking", "health", "government", "email", "messaging", "documents", "passwords", "sign-in", "focal"];

const HOST_RE = /^[a-z0-9.-]+$/;

export function SettingsManager() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [host, setHost] = useState("");
  const [mode, setMode] = useState<Site["mode"]>("skip");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/settings")
      .then((res) => (res.ok ? (res.json() as Promise<{ sites: Site[] }>) : Promise.reject(new Error())))
      .then((data) => live && setSites(data.sites))
      .catch(() => live && setError("Couldn't load settings."));
    return () => {
      live = false;
    };
  }, []);

  const save = async (next: Site[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sites: next }),
      });
      const data = (await res.json().catch(() => null)) as { sites?: Site[]; error?: { message?: string } } | null;
      if (!res.ok || !data?.sites) {
        setError(data?.error?.message ?? "Couldn't save settings.");
        return;
      }
      setSites(data.sites);
      setHost("");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const hostname = host.trim().toLowerCase();
    if (!HOST_RE.test(hostname)) {
      setError("That doesn't look like a hostname.");
      return;
    }
    const list = (sites ?? []).filter((s) => s.hostname !== hostname);
    void save([...list, { hostname, mode }]);
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "delete" }),
      });
      if (res.status === 502) {
        setError("Your data was deleted, but removing your sign-in failed. Try again.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't delete the account.");
        return;
      }
      await fetch("/sign-out", { method: "POST" }).catch(() => {});
      location.href = "/";
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sites to skip</CardTitle>
          <CardDescription>focal never runs on these sites.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1">
            {(sites ?? []).map((site) => (
              <li key={site.hostname} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{site.hostname}</span>
                <Badge variant="outline">{site.mode}</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save((sites ?? []).filter((s) => s.hostname !== site.hostname))}
                >
                  Remove
                </Button>
              </li>
            ))}
            {sites?.length === 0 && <li className="text-sm text-muted-foreground">No sites yet.</li>}
          </ul>
          <div className="flex gap-2">
            <input
              className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
              placeholder="example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
            <select
              className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as Site["mode"])}
            >
              <option value="skip">skip</option>
              <option value="off">off</option>
            </select>
            <Button variant="outline" size="sm" disabled={busy || !host.trim()} onClick={add}>
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The extension also never runs on these categories:{" "}
            {NEVER_RUN.map((c, i) => (
              <span key={c}>
                {i > 0 && ", "}
                <Badge variant="outline">{c}</Badge>
              </span>
            ))}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <a className="text-sm underline" href="/api/profile/export" download>
            Export my data
          </a>
          <div className="flex items-center gap-2">
            <input
              className="h-9 w-40 rounded-lg border border-line bg-surface px-3 text-sm"
              placeholder='type "delete"'
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <Button variant="outline" size="sm" disabled={busy || confirm !== "delete"} onClick={() => void deleteAccount()}>
              Delete account
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Deletes your account and everything in it, permanently.</p>
        </CardContent>
      </Card>
    </div>
  );
}
