"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectMeta } from "@/lib/meta/actions";

type Connected = { page_name?: string; ig_username?: string | null; connected_via?: string } | null;

export function MetaConnect({ brandId, slug, connected }: { brandId: string; slug: string; connected: Connected }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      {connected?.page_name ? (
        <p className="text-sm">
          Connected to <strong>{connected.page_name}</strong>
          {connected.ig_username ? (
            <>
              {" "}· Instagram <strong>@{connected.ig_username}</strong>
            </>
          ) : (
            <> · Instagram not linked</>
          )}
          {connected.connected_via === "oauth" ? "" : " (pasted token)"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Connect a Facebook Page and its Instagram account with one click.</p>
      )}
      <div className="flex gap-2">
        <Button nativeButton={false} render={<a href={`/api/auth/meta/start?brand=${encodeURIComponent(slug)}`} />}>
          {connected?.page_name ? "Reconnect" : "Connect Facebook"}
        </Button>
        {connected?.page_name && (
          <Button variant="outline" disabled={pending} onClick={() => confirm("Disconnect this Page?") && start(() => disconnectMeta(brandId, slug))}>
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
