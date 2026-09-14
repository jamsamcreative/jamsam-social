"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rankOpportunities, type Opportunity } from "@/lib/seo/score";
import { setKeywordCluster, deleteKeyword, clusterWithAi } from "@/lib/seo/actions";
import type { KeywordRow } from "@/lib/seo/queries";

const th = "p-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const td = "p-2 align-top";
const sel = "rounded-md border bg-background px-2 py-1 text-sm";

export function OpportunitiesTable({ brandId, keywords, targeted, freshness }: { brandId: string; keywords: KeywordRow[]; targeted: string[]; freshness: { stale: boolean; note: string } }) {
  const [cluster, setCluster] = useState("");
  const [action, setAction] = useState<"" | "NEW" | "OPTIMIZE">("");
  const [q, setQ] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [maxKd, setMaxKd] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const clusters = useMemo(() => [...new Set(keywords.map((k) => k.cluster).filter((c): c is string => Boolean(c)))].sort(), [keywords]);
  const rows = useMemo(
    () => rankOpportunities(keywords, new Set(targeted), { cluster: cluster || undefined, action: action || undefined, q: q || undefined, minVolume: minVolume ? Number(minVolume) : undefined, maxDifficulty: maxKd ? Number(maxKd) : undefined }),
    [keywords, targeted, cluster, action, q, minVolume, maxKd],
  );
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });
  const unclustered = keywords.filter((k) => !k.cluster).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input placeholder="Search keywords…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <select className={sel} value={cluster} onChange={(e) => setCluster(e.target.value)} aria-label="Cluster">
          <option value="">All clusters</option>
          {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={sel} value={action} onChange={(e) => setAction(e.target.value as typeof action)} aria-label="Action">
          <option value="">NEW + OPTIMIZE</option><option value="NEW">NEW only</option><option value="OPTIMIZE">OPTIMIZE only</option>
        </select>
        <Input type="number" placeholder="Min volume" value={minVolume} onChange={(e) => setMinVolume(e.target.value)} className="w-28" />
        <Input type="number" placeholder="Max KD" value={maxKd} onChange={(e) => setMaxKd(e.target.value)} className="w-24" />
        <span className="text-xs text-muted-foreground">{rows.length} of {keywords.length}</span>
        <span className="flex-1" />
        {unclustered > 0 && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => clusterWithAi(brandId))}>
            ✨ Cluster {unclustered} unclustered with AI
          </Button>
        )}
      </div>
      <p className={`text-xs ${freshness.stale ? "text-amber-700" : "text-muted-foreground"}`}>{freshness.note}</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr><th className={th}>Keyword</th><th className={th}>Cluster</th><th className={th}>Volume</th><th className={th}>KD</th><th className={th}>Intent</th><th className={th}>Best competitor</th><th className={th}>Us</th><th className={th}>Action</th><th className={th}>Score</th><th className={th}></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={10}>No keywords yet. Import a CSV or connect Search Console on the Imports tab.</td></tr>}
            {rows.slice(0, 300).map((k) => <Row key={k.id} k={k} brandId={brandId} pending={pending} run={run} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ k, brandId, pending, run }: { k: Opportunity<KeywordRow>; brandId: string; pending: boolean; run: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(k.cluster ?? "");
  const brief = `/articles?brief=${encodeURIComponent(k.keyword)}&cluster=${encodeURIComponent(k.cluster ?? "")}&decision=${k.action.startsWith("OPTIMIZE") ? "optimize" : "new"}`;
  return (
    <tr className="border-t">
      <td className={td}><span className="font-medium">{k.keyword}</span><span className="block text-xs text-muted-foreground">{k.source}</span></td>
      <td className={td}>
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); setEditing(false); run(() => setKeywordCluster(brandId, k.keyword, val)); }} className="flex gap-1">
            <Input value={val} onChange={(e) => setVal(e.target.value)} className="h-7 w-36" autoFocus /><Button size="sm" type="submit">Save</Button>
          </form>
        ) : (
          <button type="button" className="text-left underline decoration-dotted" onClick={() => setEditing(true)}>{k.cluster ?? <span className="text-muted-foreground">set…</span>}</button>
        )}
      </td>
      <td className={`${td} tabular-nums`}>{k.volume?.toLocaleString("en-US") ?? "—"}</td>
      <td className={`${td} tabular-nums`}>{k.difficulty ?? "—"}</td>
      <td className={td}>{k.intent ?? "—"}</td>
      <td className={td}>{k.competitor ? <>{k.competitor}<span className="text-xs text-muted-foreground"> #{k.competitor_position}</span></> : "—"}</td>
      <td className={td}>{k.our_position ? <>#{Math.round(k.our_position)}{k.our_impressions != null && <span className="block text-xs text-muted-foreground">{k.our_impressions.toLocaleString("en-US")} imp · {k.our_clicks ?? 0} clicks</span>}</> : "—"}</td>
      <td className={td}><span className={k.action === "NEW" ? "rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-900" : "rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-900"}>{k.action}</span>{k.our_page && <a href={k.our_page} target="_blank" rel="noreferrer" className="block max-w-[200px] truncate text-xs text-muted-foreground underline">{k.our_page.replace(/^https?:\/\/[^/]+/, "")}</a>}</td>
      <td className={`${td} tabular-nums font-semibold`}>{k.score.toFixed(2)}</td>
      <td className={`${td} whitespace-nowrap`}>
        <Button size="sm" nativeButton={false} render={<Link href={brief} />}>Write this</Button>{" "}
        <button type="button" className="text-xs text-muted-foreground underline" disabled={pending} onClick={() => run(() => deleteKeyword(brandId, k.keyword))}>remove</button>
      </td>
    </tr>
  );
}
