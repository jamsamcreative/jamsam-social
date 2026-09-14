import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await createAdminSupabase().from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
