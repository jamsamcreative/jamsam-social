import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { decryptJson } from "@/lib/crypto";
import type { Database } from "@/lib/database.types";
import type { Provider } from "./types";

type Row = Database["public"]["Tables"]["brand_connections"]["Row"];
export type ConnectionPublic = Omit<Row, "secret"> & { has_secret: boolean };

export async function listConnectionsForBrand(brandId: string): Promise<ConnectionPublic[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("brand_connections").select("*").eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  // Strip the ciphertext before it can reach any component.
  return data.map(({ secret, ...rest }) => ({ ...rest, has_secret: Boolean(secret) }));
}

/** Server-only. Returns decrypted credentials for use by publishers/pushers. */
export async function getConnectionWithSecret<C = Record<string, unknown>, S = Record<string, unknown>>(
  brandId: string,
  provider: Provider,
): Promise<{ id: string; config: C; secret: S } | null> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("brand_connections")
    .select("id,config,secret")
    .eq("brand_id", brandId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.secret) return null;
  return { id: data.id, config: data.config as C, secret: decryptJson<S>(data.secret) };
}
