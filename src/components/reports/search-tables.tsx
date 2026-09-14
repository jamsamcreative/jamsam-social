"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export type SearchRow = { key: string; clicks: number; impressions: number; ctr: string; position: string; change: string | null; up: boolean | null };
const th = "p-2 text-left text-xs font-medium text-muted-foreground";
const td = "p-2 tabular-nums";

function Table({ title, rows, q }: { title: string; rows: SearchRow[]; q: string }) {
  const shown = rows.filter((r) => r.key.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className={th}>{title === "Top queries" ? "Query" : "Page"}</th><th className={th}>Clicks</th><th className={th}>vs previous</th><th className={th}>Impressions</th><th className={th}>CTR</th><th className={th}>Position</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={6}>Nothing matches.</td></tr>}
            {shown.map((r) => (
              <tr key={r.key} className="border-t">
                <td className={`${td} max-w-md truncate`} title={r.key}>{r.key}</td>
                <td className={td}>{r.clicks.toLocaleString("en-US")}</td>
                <td className={td}>{r.change ? <span className={r.up ? "text-green-700" : "text-red-700"}>{r.change}</span> : <span className="text-muted-foreground">—</span>}</td>
                <td className={td}>{r.impressions.toLocaleString("en-US")}</td><td className={td}>{r.ctr}</td><td className={td}>{r.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SearchTables({ queries, pages }: { queries: SearchRow[]; pages: SearchRow[] }) {
  const [q, setQ] = useState("");
  return (
    <div className="space-y-4">
      <Input placeholder="Filter queries and pages…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <Table title="Top queries" rows={queries} q={q} />
      <Table title="Top pages" rows={pages} q={q} />
    </div>
  );
}
