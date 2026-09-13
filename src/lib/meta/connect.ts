import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { encryptJson } from "@/lib/crypto";
import { runConnectionTest } from "@/lib/connections/actions";
import type { PageCandidate } from "./oauth";
import type { Json } from "@/lib/database.types";

export async function saveMetaPage(brandId: string, page: PageCandidate, user: { id: string; name: string }) {
  const admin = createAdminSupabase();
  const config = {
    page_id: page.id,
    page_name: page.name,
    ig_user_id: page.ig_user_id ?? null,
    ig_username: page.ig_username ?? null,
    connected_via: "oauth",
    fb_user_id: user.id,
    fb_user_name: user.name,
  } as Json;
  const { data, error } = await admin
    .from("brand_connections")
    .upsert(
      { brand_id: brandId, provider: "meta", config, secret: encryptJson({ page_access_token: page.access_token }), status: "not_connected" },
      { onConflict: "brand_id,provider" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save connection");
  await runConnectionTest(data.id);
}

export async function disconnectMeta(brandId: string) {
  const admin = createAdminSupabase();
  await admin.from("brand_connections").delete().eq("brand_id", brandId).eq("provider", "meta");
}
