"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Loc = { name: string; title: string; enabled: boolean };

/** Connect via Google OAuth; then tick which locations approved posts should go to. Serialises into the hidden `locations` field. */
export function GbpLocations({ slug, initial, connected }: { slug: string; initial: Loc[]; connected: boolean }) {
  const [locs, setLocs] = useState<Loc[]>(initial);
  const toggle = (name: string) => setLocs((ls) => ls.map((l) => (l.name === name ? { ...l, enabled: !l.enabled } : l)));
  return (
    <div className="space-y-3">
      <input type="hidden" name="locations" value={JSON.stringify(locs)} />
      <div className="flex items-center gap-2">
        <Button type="button" nativeButton={false} render={<a href={`/api/auth/google/start?brand=${encodeURIComponent(slug)}`} />}>
          {connected ? "Reconnect Google" : "Connect Google"}
        </Button>
        <p className="text-xs text-muted-foreground">Sign in with a Google account that manages the client&apos;s Business Profile.</p>
      </div>
      {locs.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Approved posts also go out as Google posts to every location ticked here. Nothing publishes to a location that is not ticked.</p>
          {locs.map((l) => (
            <label key={l.name} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={l.enabled} onChange={() => toggle(l.name)} /> {l.title}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
