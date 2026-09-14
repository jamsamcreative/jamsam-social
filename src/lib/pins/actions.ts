"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { parsePinForm } from "./schema";
import { validatePin } from "./rules";
import { zonedLocalToUtc } from "@/lib/time/zoned";
import { syncBoardsForBrand } from "./boards";
import type { Pin } from "./queries";

export type ActionResult = { ok: true; id?: string; warnings?: string[] } | { ok: false; error: string };

async function ctx() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}
type Loaded = { error: string; supabase?: undefined; user?: undefined; pin?: undefined; host?: undefined } | { error?: undefined; supabase: Awaited<ReturnType<typeof createServerSupabase>>; user: { id: string }; pin: Pin; host: string | null };
async function load(id: string): Promise<Loaded> {
  const { supabase, user } = await ctx();
  if (!user) return { error: "Not signed in" };
  const { data } = await supabase.from("pins").select("*, brand:brands(website_url)").eq("id", id).maybeSingle();
  if (!data) return { error: "Pin not found" };
  const { brand, ...pin } = data as unknown as Pin & { brand: { website_url: string | null } };
  let host: string | null = null;
  try {
    host = brand.website_url ? new URL(brand.website_url).hostname : null;
  } catch {}
  return { supabase, user, pin, host };
}
function refresh() {
  revalidatePath("/pins", "layout");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function savePin(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = parsePinForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid pin" };
  const i = parsed.data;
  const { data: brand } = await supabase.from("brands").select("timezone,website_url").eq("id", i.brand_id).single();
  if (!brand) return { ok: false, error: "Brand not found" };
  const scheduled_at = i.scheduled_local ? zonedLocalToUtc(i.scheduled_local, brand.timezone) : null;
  const row = { board_id: i.board_id, board_name: i.board_name ?? null, title: i.title, description: i.description, link: i.link, alt_text: i.alt_text, image_url: i.image_url, media_asset_id: i.media_asset_id ?? null, project_id: i.project_id ?? null, scheduled_at };
  const check = validatePin(row, brand.website_url ? new URL(brand.website_url).hostname : null);
  if (check.errors.length) return { ok: false, error: check.errors[0] };
  let id = i.id;
  if (id) {
    const { data: existing } = await supabase.from("pins").select("status").eq("id", id).single();
    if (!existing) return { ok: false, error: "Pin not found" };
    if (["publishing", "published"].includes(existing.status)) return { ok: false, error: "Published pins cannot be edited" };
    const { error } = await supabase.from("pins").update({ ...row, status: "draft" }).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase.from("pins").insert({ ...row, brand_id: i.brand_id, created_by: user.id }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create pin" };
    id = data.id;
  }
  refresh();
  return { ok: true, id, warnings: check.warnings };
}

export async function submitPin(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.pin.status !== "draft") return { ok: false, error: "Only drafts can be submitted" };
  const check = validatePin(r.pin, r.host);
  if (check.errors.length) return { ok: false, error: check.errors[0] };
  await r.supabase.from("pins").update({ status: "pending_approval" }).eq("id", id);
  refresh();
  return { ok: true, warnings: check.warnings };
}

export async function approvePin(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.pin.status !== "pending_approval") return { ok: false, error: "Pin is not awaiting approval" };
  if (!r.pin.scheduled_at) return { ok: false, error: "Set a schedule time before approving (Pinterest has no native scheduling; we publish it for you)" };
  await r.supabase.from("pins").update({ status: "approved", approved_by: r.user.id, approved_at: new Date().toISOString(), error: null }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function rejectPin(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.pin.status !== "pending_approval") return { ok: false, error: "Pin is not awaiting approval" };
  await r.supabase.from("pins").update({ status: "draft" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function publishPinNow(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (!["draft", "pending_approval", "approved", "failed"].includes(r.pin.status)) return { ok: false, error: "Pin cannot be published from its current state" };
  const check = validatePin(r.pin, r.host);
  if (check.errors.length) return { ok: false, error: check.errors[0] };
  await r.supabase.from("pins").update({ status: "approved", approved_by: r.user.id, approved_at: new Date().toISOString(), scheduled_at: new Date().toISOString(), attempts: 0, error: null }).eq("id", id);
  refresh();
  return { ok: true, warnings: check.warnings };
}

export async function retryPin(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.pin.status !== "failed") return { ok: false, error: "Only failed pins can be retried" };
  await r.supabase.from("pins").update({ status: "approved", attempts: 0, error: null, scheduled_at: r.pin.scheduled_at ?? new Date().toISOString() }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function archivePin(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.pin.status === "publishing") return { ok: false, error: "Wait for publishing to finish" };
  await r.supabase.from("pins").update({ status: "archived" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function reschedulePin(id: string, newIso: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (["publishing", "published"].includes(r.pin.status)) return { ok: false, error: "Published pins cannot be moved" };
  await r.supabase.from("pins").update({ scheduled_at: newIso }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function syncBoards(brandId: string): Promise<ActionResult> {
  const { user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  try {
    const r = await syncBoardsForBrand(brandId);
    revalidatePath("/brands", "layout");
    revalidatePath("/pins", "layout");
    return { ok: true, warnings: [`${r.boards} board${r.boards === 1 ? "" : "s"} synced`] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
