import { googleJson, type GoogleDeps } from "./api";

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type GscQueryBody = { startDate: string; endDate: string; dimensions: string[]; rowLimit?: number; startRow?: number; type?: string };

export async function gscQuery(siteUrl: string, body: GscQueryBody, deps: GoogleDeps): Promise<{ rows: GscRow[] }> {
  const raw = await googleJson<{ rows?: GscRow[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, deps, {
    method: "POST",
    body: JSON.stringify({ rowLimit: 25000, ...body }),
  });
  return { rows: (raw.rows ?? []).map((r) => ({ keys: r.keys ?? [], clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0, ctr: Number(r.ctr) || 0, position: Number(r.position) || 0 })) };
}
