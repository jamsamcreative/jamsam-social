"use client";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectionFields } from "./connection-forms";
import { saveAndTestConnection, type ActionResult } from "@/lib/connections/actions";
import { PROVIDER_LABELS, type Provider } from "@/lib/connections/types";
import type { ConnectionPublic } from "@/lib/connections/queries";

export function StatusBadge({ status }: { status: ConnectionPublic["status"] | "missing" }) {
  if (status === "connected") return <Badge className="bg-green-600 text-white hover:bg-green-600">Connected</Badge>;
  if (status === "failing") return <Badge variant="destructive">Failing</Badge>;
  return <Badge variant="secondary">Not connected</Badge>;
}

export function ConnectionCard({
  brandId,
  provider,
  connection,
}: {
  brandId: string;
  provider: Provider;
  connection: ConnectionPublic | null;
}) {
  const action = saveAndTestConnection.bind(null, brandId, provider);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const [retesting, startRetest] = useTransition();
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  const status = connection?.status ?? "missing";
  const shown = lastResult ?? state;
  const cfg = (connection?.config as Record<string, unknown> | null) ?? {};

  function retest() {
    if (!connection) return;
    startRetest(async () => {
      const res = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" });
      const body = (await res.json()) as ActionResult;
      setLastResult(body);
      if (body.ok) toast.success(body.detail);
      else toast.error(body.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{PROVIDER_LABELS[provider]}</CardTitle>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-4">
        {provider === "meta" && typeof cfg.page_name === "string" && (
          <p className="text-sm text-muted-foreground">
            Page: {cfg.page_name}
            {typeof cfg.ig_username === "string" && cfg.ig_username ? ` · Instagram @${cfg.ig_username}` : " · Instagram not linked"}
          </p>
        )}
        <form action={formAction} className="space-y-4">
          <ConnectionFields provider={provider} config={cfg} />
          {shown && (
            <p className={shown.ok ? "text-sm text-green-700" : "text-sm text-destructive"}>
              {shown.ok ? shown.detail : shown.error}
            </p>
          )}
          {!shown && connection?.last_error && <p className="text-sm text-destructive">{connection.last_error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Testing..." : "Save & test"}
            </Button>
            {connection?.has_secret && (
              <Button type="button" variant="outline" onClick={retest} disabled={retesting}>
                {retesting ? "Testing..." : "Test"}
              </Button>
            )}
          </div>
          {connection?.last_checked && (
            <p className="text-xs text-muted-foreground">Last checked {new Date(connection.last_checked).toLocaleString()}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
