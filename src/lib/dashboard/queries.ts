import { createServerSupabase } from "@/lib/supabase/server";
import { listBrands, type Brand } from "@/lib/brands/queries";
import { PROVIDER_ORDER, type Provider } from "@/lib/connections";
import type { Database } from "@/lib/database.types";

type ConnectionStatus = Database["public"]["Enums"]["connection_status"];
export type DashboardBrand = Brand & {
  connections: Record<Provider, ConnectionStatus | "missing">;
  media_count: number;
};

export async function getDashboardBrands(): Promise<DashboardBrand[]> {
  const supabase = await createServerSupabase();
  const brands = await listBrands();
  const ids = brands.map((b) => b.id);
  if (ids.length === 0) return [];

  const [{ data: conns, error: cErr }, { data: media, error: mErr }] = await Promise.all([
    supabase.from("brand_connections").select("brand_id,provider,status").in("brand_id", ids),
    supabase.from("media_assets").select("brand_id").in("brand_id", ids),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (mErr) throw new Error(mErr.message);

  return brands.map((b) => {
    const connections = Object.fromEntries(PROVIDER_ORDER.map((p) => [p, "missing"])) as DashboardBrand["connections"];
    for (const c of conns ?? []) if (c.brand_id === b.id) connections[c.provider as Provider] = c.status;
    const media_count = (media ?? []).filter((m) => m.brand_id === b.id).length;
    return { ...b, connections, media_count };
  });
}
