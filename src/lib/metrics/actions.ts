"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { syncBrandMetrics } from "./run";
import type { SyncResult } from "./sync";

export type SyncNowResult = { ok: true; result: SyncResult } | { ok: false; error: string };
const COOLDOWN_MS = 5 * 60_000;

export async function syncNow(brandId: string): Promise<SyncNowResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: runs } = await createAdminSupabase().from("sync_runs").select("last_run_at").eq("brand_id", brandId).neq("source", "plan");
  const latest = Math.max(0, ...(runs ?? []).map((r) => (r.last_run_at ? Date.parse(r.last_run_at) : 0)));
  if (Date.now() - latest < COOLDOWN_MS) return { ok: false, error: `Synced ${Math.round((Date.now() - latest) / 60000)} min ago — try again in a few minutes` };
  try {
    const result = await syncBrandMetrics(brandId);
    revalidatePath("/reports");
    revalidatePath("/brands", "layout");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
