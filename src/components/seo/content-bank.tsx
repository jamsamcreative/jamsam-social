"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ProjectRow } from "@/lib/seo/queries";

const sel = "rounded-md border bg-background px-2 py-1 text-sm";

export function ContentBank({ rows, categories, states }: { rows: ProjectRow[]; categories: string[]; states: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [open, setOpen] = useState<ProjectRow | null>(null);
  const go = (patch: Record<string, string>) => {
    const u = new URLSearchParams(sp.toString());
    u.set("tab", "bank");
    for (const [k, v] of Object.entries(patch)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    router.push(`/seo?${u.toString()}`);
  };
  const copyFacts = (p: ProjectRow) => {
    const imgs = (p.images as { url: string }[]).map((i) => i.url).join("\n");
    navigator.clipboard.writeText([p.title, p.dims && `Size: ${p.dims}`, p.location && `Location: ${p.location}`, p.category && `Type: ${p.category}`, p.description, p.url, imgs].filter(Boolean).join("\n")).then(() => toast.success("Facts copied"));
  };
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); go({ q }); }} className="flex flex-wrap gap-2">
        <Input placeholder="Search projects (e.g. 36x30 shop Ellensburg)…" value={q} onChange={(e) => setQ(e.target.value)} className="w-80" />
        <select className={sel} value={sp.get("category") ?? ""} onChange={(e) => go({ category: e.target.value })} aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className={sel} value={sp.get("state") ?? ""} onChange={(e) => go({ state: e.target.value })} aria-label="State"><option value="">All states</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <Button type="submit" size="sm" variant="outline">Search</Button>
      </form>
      {rows.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">No projects yet. Import a CSV or crawl a sitemap section on the Imports tab.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const img = (p.images as { url: string; alt?: string }[])[0];
            return (
              <button type="button" key={p.id} onClick={() => setOpen(p)} className="overflow-hidden rounded-lg border text-left hover:bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {img ? <img src={img.url} alt={img.alt ?? ""} className="h-36 w-full object-cover" /> : <div className="h-36 w-full bg-muted" />}
                <div className="space-y-0.5 p-3">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{[p.dims, p.category, p.location ?? p.state].filter(Boolean).join(" · ") || "—"}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">{open.title}</h3>
              <button type="button" className="text-sm underline" onClick={() => setOpen(null)}>Close</button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{[open.dims, open.category, open.location ?? open.state, open.external_id && `Job ${open.external_id}`].filter(Boolean).join(" · ")}</p>
            {open.description && <p className="mt-3 text-sm">{open.description}</p>}
            {open.url && <a href={open.url} target="_blank" rel="noreferrer" className="mt-2 block text-sm underline">{open.url}</a>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(open.images as { url: string; alt?: string }[]).map((i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i.url} src={i.url} alt={i.alt ?? ""} className="h-24 w-full rounded object-cover" />
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={() => copyFacts(open)}>Copy facts for a post</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
