"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importKeywordsCsv, importProjectsCsv, startCrawl, semrushEstimate, refreshSemrush, refreshGsc, mirrorSiteNow, type ActionResult } from "@/lib/seo/actions";
import type { ImportRow } from "@/lib/seo/queries";

const KIND: Record<string, string> = { keywords_csv: "Keywords CSV", projects_csv: "Projects CSV", sitemap_crawl: "Sitemap crawl", semrush_refresh: "SEMrush refresh", gsc_refresh: "Search Console refresh", site_mirror: "Site mirror" };

function UploadForm({ action, label, help, accept = ".csv,text/csv" }: { action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>; label: string; help: string; accept?: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) { toast.success(state.message ?? "Done"); router.refresh(); } else toast.error(state.error);
  }, [state, router]);
  return (
    <form action={formAction} className="space-y-2 rounded-lg border p-4">
      <Label htmlFor={label}>{label}</Label>
      <Input id={label} name="file" type="file" accept={accept} required />
      <p className="text-xs text-muted-foreground">{help}</p>
      <Button size="sm" type="submit" disabled={pending}>{pending ? "Importing…" : "Import"}</Button>
    </form>
  );
}

function CrawlForm({ action, siteUrl }: { action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>; siteUrl: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) { toast.success(state.message ?? "Started"); router.refresh(); } else toast.error(state.error);
  }, [state, router]);
  return (
    <form action={formAction} className="space-y-2 rounded-lg border p-4">
      <p className="text-sm font-medium">Crawl project pages from the site</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="site_url">Site URL</Label><Input id="site_url" name="site_url" defaultValue={siteUrl} placeholder="https://client.com" required /></div>
        <div className="space-y-1"><Label htmlFor="prefix">Path prefix</Label><Input id="prefix" name="prefix" placeholder="/projects/" required /></div>
      </div>
      <p className="text-xs text-muted-foreground">Reads the sitemap, keeps URLs under the prefix (max 500), and pulls title, description, photos, size and location from each page. Runs in the background.</p>
      <Button size="sm" type="submit" disabled={pending}>{pending ? "Starting…" : "Start crawl"}</Button>
    </form>
  );
}

export function Imports({ brandId, siteUrl, imports, hasSemrush, hasWordpress, hasGsc }: { brandId: string; siteUrl: string; imports: ImportRow[]; hasSemrush: boolean; hasWordpress: boolean; hasGsc: boolean }) {
  const [pending, start] = useTransition();
  const [estimate, setEstimate] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(r.message ?? "Done"); router.refresh(); } else toast.error(r.error);
    });
  const askSemrush = () =>
    start(async () => {
      const r = await semrushEstimate(brandId);
      if (!r.ok) return void toast.error(r.error);
      setEstimate(`≈ ${r.data!.units.toLocaleString("en-US")} API units: overview for ${r.data!.keywords} keywords${r.data!.gapRows ? ` + keyword gap vs ${r.data!.competitors.join(", ")}` : " (add competitor domains on the SEMrush connection to include a keyword gap)"}`);
    });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <UploadForm action={importKeywordsCsv.bind(null, brandId)} label="Keywords CSV" help="SEMrush Keyword Gap / Keyword Magic exports or any CSV with keyword, volume, difficulty, intent, competitor, position, cluster columns. Re-importing updates existing keywords." />
        <UploadForm action={importProjectsCsv.bind(null, brandId)} label="Projects CSV" help="Columns: title, url, category, city, state, size, description, photos (| separated URLs), tags." />
      </div>
      <CrawlForm action={startCrawl.bind(null, brandId)} siteUrl={siteUrl} />
      <div className="flex flex-wrap gap-2 rounded-lg border p-4">
        <Button size="sm" variant="outline" disabled={pending || !hasWordpress} onClick={() => run(() => mirrorSiteNow(brandId))} title={hasWordpress ? "" : "Connect WordPress first"}>Mirror site now</Button>
        <Button size="sm" variant="outline" disabled={pending || !hasGsc} onClick={() => run(() => refreshGsc(brandId))} title={hasGsc ? "" : "Connect Search Console first"}>Refresh from Search Console</Button>
        <Button size="sm" variant="outline" disabled={pending || !hasSemrush} onClick={askSemrush} title={hasSemrush ? "" : "Connect SEMrush first"}>Refresh from SEMrush…</Button>
        {estimate && (
          <span className="flex items-center gap-2 text-sm">
            <span>{estimate}</span>
            <Button size="sm" disabled={pending} onClick={() => { setEstimate(null); run(() => refreshSemrush(brandId)); }}>Run</Button>
            <button type="button" className="text-xs underline" onClick={() => setEstimate(null)}>cancel</button>
          </span>
        )}
      </div>
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr><th className="p-2 text-left text-xs font-medium text-muted-foreground">When</th><th className="p-2 text-left text-xs font-medium text-muted-foreground">What</th><th className="p-2 text-left text-xs font-medium text-muted-foreground">Detail</th><th className="p-2 text-left text-xs font-medium text-muted-foreground">Rows</th></tr></thead>
          <tbody>
            {imports.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={4}>Nothing imported yet.</td></tr>}
            {imports.map((i) => <tr key={i.id} className="border-t"><td className="p-2 whitespace-nowrap">{new Date(i.created_at).toLocaleString()}</td><td className="p-2">{KIND[i.kind] ?? i.kind}</td><td className="max-w-md truncate p-2 text-muted-foreground" title={i.detail ?? ""}>{i.detail}</td><td className="p-2 tabular-nums">{i.rows}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
