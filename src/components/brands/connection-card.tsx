"use client";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectionFields } from "./connection-forms";
import { MetaConnect } from "./meta-connect";
import { GoogleGrantSteps } from "./google-grant-steps";
import { Ga4LeadEvents } from "./ga4-lead-events";
import { MetaAdAccounts } from "./meta-ad-accounts";
import { GbpLocations } from "./gbp-locations";
import { PinterestConnect } from "./pinterest-connect";
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
  slug,
  provider,
  connection,
  serviceAccountEmail = null,
  pinterestOauth = false,
  boards = [],
}: {
  brandId: string;
  slug: string;
  provider: Provider;
  connection: ConnectionPublic | null;
  serviceAccountEmail?: string | null;
  pinterestOauth?: boolean;
  boards?: { board_id: string; name: string; pin_count: number | null; pins_in_app: number; measured: number; median_impressions: number | null }[];
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
        {provider === "meta" && (
          <MetaConnect brandId={brandId} slug={slug} connected={connection ? (cfg as { page_name?: string; ig_username?: string | null; connected_via?: string }) : null} />
        )}
        {provider === "meta" && <p className="text-xs text-muted-foreground">Or paste a long-lived Page token below.</p>}
        {provider === "pinterest" && <PinterestConnect brandId={brandId} slug={slug} oauth={pinterestOauth} connected={connection?.status === "connected" ? (cfg as { username?: string }) : null} boards={boards} />}
        <form action={formAction} className="space-y-4">
          <ConnectionFields
            provider={provider}
            config={cfg}
            extras={
              provider === "google_analytics" ? <GoogleGrantSteps email={serviceAccountEmail} product="ga4" /> : provider === "search_console" ? <GoogleGrantSteps email={serviceAccountEmail} product="gsc" /> : null
            }
          />
          {provider === "google_analytics" && (
            <>
              <input type="hidden" name="ads_linked" value={String(Boolean(cfg.ads_linked))} />
              <Ga4LeadEvents initial={(cfg.lead_events as string[] | undefined) ?? []} propertyInputId="google_analytics-property_id" />
            </>
          )}
          {provider === "meta_ads" && <MetaAdAccounts tokenInputId="meta_ads-access_token" accountInputId="meta_ads-ad_account_id" />}
          {provider === "gbp" && <GbpLocations slug={slug} initial={(cfg.locations as { name: string; title: string; enabled: boolean }[] | undefined) ?? []} connected={Boolean(connection?.has_secret)} />}
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
