"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveSeoTools, type ActionResult } from "@/lib/brands/actions";
import { normaliseTarget, type SeoTools } from "@/lib/brands/seo-tools";

/**
 * Reference identifiers for tools Claude reaches through its own MCP connectors. Both cards share one
 * form + one save action so a partial edit never clobbers the other tool.
 */
export function SeoToolsCards(props: { brandId: string; slug: string; tools: SeoTools; websiteUrl: string | null }) {
  // Remount the inputs when the saved value changes so their defaultValues track the revalidated props.
  return <SeoToolsForm key={JSON.stringify(props.tools)} {...props} />;
}

function SeoToolsForm({ brandId, slug, tools, websiteUrl }: { brandId: string; slug: string; tools: SeoTools; websiteUrl: string | null }) {
  const [state, action, pending] = useActionState(saveSeoTools.bind(null, brandId, slug), null as ActionResult | null);
  useEffect(() => {
    if (state?.ok) toast.success("SEO tools saved");
  }, [state]);
  const lf = tools.local_falcon;
  const ah = tools.ahrefs;
  const defaultTarget = ah?.target ?? normaliseTarget(websiteUrl ?? "");

  return (
    <form action={action} className="contents">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Local Falcon</CardTitle>
          <Badge variant={lf ? "default" : "secondary"}>{lf ? "Reference set" : "Reference"}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lf_place_id">Google Place ID</Label>
            <Input id="lf_place_id" name="lf_place_id" defaultValue={lf?.place_id ?? ""} placeholder="ChIJ…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lf_business_name">Business name (as on Google)</Label>
            <Input id="lf_business_name" name="lf_business_name" defaultValue={lf?.business_name ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lf_keywords">Grid keywords (one per line)</Label>
            <Textarea id="lf_keywords" name="lf_keywords" rows={4} defaultValue={(lf?.keywords ?? []).join("\n")} placeholder={"personal injury lawyer spokane\ncar accident attorney"} />
          </div>
          <p className="text-xs text-muted-foreground">No API key — Claude runs Local Falcon scans through its own connector using these identifiers.</p>
          {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" disabled={pending}>Save SEO tools</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Ahrefs</CardTitle>
          <Badge variant={ah ? "default" : "secondary"}>{ah ? "Reference set" : "Reference"}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ahrefs_target">Target domain</Label>
            <Input id="ahrefs_target" name="ahrefs_target" defaultValue={defaultTarget} placeholder="example.com" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ahrefs_project_id">Project ID (Rank Tracker / Brand Radar, optional)</Label>
            <Input id="ahrefs_project_id" name="ahrefs_project_id" defaultValue={ah?.project_id ?? ""} />
          </div>
          <p className="text-xs text-muted-foreground">No API key — Claude pulls Ahrefs data through its own connector for this target. Saved together with Local Falcon.</p>
        </CardContent>
      </Card>
    </form>
  );
}
