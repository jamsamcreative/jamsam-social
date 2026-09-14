import { createServerSupabase } from "@/lib/supabase/server";
import type { MetricRow, MetricSource } from "./types";
import type { Window } from "./ranges";
import type { Database } from "@/lib/database.types";

export type SyncRun = Database["public"]["Tables"]["sync_runs"]["Row"];

export async function loadRows(brandId: string, sources: MetricSource[], w: Window): Promise<MetricRow[]> {
  const supabase = await createServerSupabase();
  const out: MetricRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("metrics_daily")
      .select("source,date,dim,metrics,extra")
      .eq("brand_id", brandId)
      .in("source", sources)
      .gte("date", w.start)
      .lte("date", w.end)
      .order("date")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.push({ source: r.source, date: r.date, dim: r.dim, metrics: r.metrics as Record<string, number>, extra: (r.extra as Record<string, string> | null) ?? undefined });
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadSyncRuns(brandId: string): Promise<SyncRun[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("sync_runs").select("*").eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  return data;
}

export async function earliestDate(brandId: string): Promise<string | undefined> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("metrics_daily").select("date").eq("brand_id", brandId).order("date").limit(1).maybeSingle();
  return data?.date ?? undefined;
}
