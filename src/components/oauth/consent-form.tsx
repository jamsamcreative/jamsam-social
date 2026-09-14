"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { approveAuthorization } from "@/lib/oauth/actions";
import type { AuthorizeParams } from "@/lib/oauth/server";

export function ConsentForm({ params, clientName, email }: { params: AuthorizeParams; clientName: string; email: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const deny = () => {
    const u = new URL(params.redirect_uri);
    u.searchParams.set("error", "access_denied");
    if (params.state) u.searchParams.set("state", params.state);
    window.location.href = u.toString();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="font-medium">{clientName}</span> wants to use JamSam Social as <span className="font-medium">{email}</span>: read brands, guidelines and media, and create posts, articles and jobs on your behalf.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await approveAuthorization(params);
              if (r && !r.ok) setError(r.error);
            })
          }
        >
          {pending ? "Connecting…" : "Allow"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={deny}>
          Deny
        </Button>
      </div>
    </div>
  );
}
