import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Pin = Database["public"]["Tables"]["pins"]["Row"];
export type PinBoard = Database["public"]["Tables"]["pin_boards"]["Row"];
export type PinStatus = Pin["status"];
export type PinInsightsJson = { impressions?: number; saves?: number; pin_clicks?: number; outbound_clicks?: number; fetched_at?: string } | null;

export async function listPins(opts: { brandId: string; status?: PinStatus[] }): Promise<Pin[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("pins").select("*").eq("brand_id", opts.brandId).order("updated_at", { ascending: false }).limit(300);
  if (opts.status?.length) q = q.in("status", opts.status);
  else q = q.neq("status", "archived");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function getPin(id: string): Promise<(Pin & { brand: { slug: string; name: string; timezone: string; website_url: string | null } }) | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("pins").select("*, brand:brands(slug,name,timezone,website_url)").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as (Pin & { brand: { slug: string; name: string; timezone: string; website_url: string | null } }) | null;
}

export async function listBoards(brandId: string): Promise<PinBoard[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("pin_boards").select("*").eq("brand_id", brandId).order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function listPinsInRange(brandId: string, fromIso: string, toIso: string): Promise<Pin[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("pins").select("*").eq("brand_id", brandId).not("scheduled_at", "is", null).gte("scheduled_at", fromIso).lt("scheduled_at", toIso).neq("status", "archived");
  if (error) throw new Error(error.message);
  return data;
}
