"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Loose row shape — db ActivityRecord stores actor as a plain string. */
export interface Row {
  id: string;
  actor: string;
  action: string;
  entryId: string;
  before?: unknown;
  after?: unknown;
  at: string;
  undoes?: string | null;
  undoneBy?: string | null;
}

const nameOf = (v: unknown): string | undefined =>
  v !== null && typeof v === "object" ? (v as { name?: string }).name : undefined;

function describe(event: Row): string {
  const name = nameOf(event.after) ?? nameOf(event.before) ?? event.entryId;
  switch (event.action) {
    case "add":
      return `added ${name}`;
    case "remove":
      return `removed ${name}`;
    case "change":
      return `changed ${name}`;
    case "approve":
      return `approved ${name}`;
    case "undo":
      return `undid an earlier change`;
    default:
      return `${event.action} ${name}`;
  }
}

export function ActivityFeed({ activity, hasMore }: { activity: Row[]; hasMore: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = activity[activity.length - 1];

  const undo = async (eventId: string) => {
    setBusy(eventId);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "undo", event_id: eventId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(data?.error?.message ?? "That change is no longer available.");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet — taste changes will show up as they happen.</p>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y p-0">
            {activity.map((event) => {
              const undoable = !event.undoneBy && event.action !== "undo";
              return (
                <div key={event.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Badge variant="outline" className="shrink-0">
                    {event.actor}
                  </Badge>
                  <span className="flex-1">
                    {describe(event)}{" "}
                    <span className="text-muted-foreground">· {new Date(event.at).toLocaleString()}</span>
                  </span>
                  {event.undoneBy && <Badge variant="outline">undone</Badge>}
                  {undoable && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === event.id}
                      onClick={() => void undo(event.id)}
                    >
                      Undo
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      {hasMore && last && (
        <Link className="text-sm text-muted-foreground underline" href={`/activity?before=${encodeURIComponent(last.at)}`}>
          Load older
        </Link>
      )}
    </div>
  );
}
