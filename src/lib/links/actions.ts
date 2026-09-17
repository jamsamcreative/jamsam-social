"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import { createWpClient } from "@/lib/wordpress/client";
import type { WordpressConfig, WordpressSecret } from "@/lib/connections/wordpress-shared";
import { createSupabaseLinksStore } from "./store";
import { scanBrand } from "./scan";
import { approveSuggestion, rejectSuggestion, undoSuggestion, type ApplyResult, type WpAdapter } from "./apply-actions";
import { wpAdapterFor } from "./wp-adapter";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
/** One line per brand scanned; `ok` false carries the mirror/scan error in `message`. */
export type ScanBrandMessage = { brandId: string; brand: string; ok: boolean; message: string };

async function user(): Promise<{ id: string } | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}
function refresh() {
  revalidatePath("/blog/links");
  revalidatePath("/blog");
}
/** The brand's WordPress connection as the adapter approve/undo need. */
async function wpFor(brandId: string): Promise<WpAdapter> {
  const conn = await getConnectionWithSecret<WordpressConfig, WordpressSecret>(brandId, "wordpress");
  if (!conn) throw new Error("WordPress is not connected");
  return wpAdapterFor(createWpClient(conn.config, conn.secret));
}

/** Scan one brand, or every active brand in sequence when `brandId` is `"all"`; one message per brand. Fails only when nothing could be scanned. */
export async function scanAction(brandId: string | "all"): Promise<ActionResult<ScanBrandMessage[]>> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  const store = createSupabaseLinksStore();
  const brands = brandId === "all" ? await store.listActiveBrands() : [await store.getBrand(brandId)].flatMap((b) => (b ? [b] : []));
  if (!brands.length) return { ok: false, error: brandId === "all" ? "No active brands" : "Brand not found" };
  const messages: ScanBrandMessage[] = [];
  for (const b of brands) {
    try {
      const r = await scanBrand(store, { brandId: b.id, userId: u.id });
      messages.push("error" in r
        ? { brandId: b.id, brand: b.name, ok: false, message: r.error }
        : { brandId: b.id, brand: b.name, ok: true, message: `${r.pages} pages, ${r.links} links, ${r.orphans} orphans — ${r.suggested} suggested, ${r.none} without a suggestion` });
    } catch (e) {
      messages.push({ brandId: b.id, brand: b.name, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  refresh();
  if (messages.every((m) => !m.ok)) return { ok: false, error: messages.map((m) => `${m.brand}: ${m.message}`).join("; ") };
  return { ok: true, data: messages };
}

/** Lifts the core's result onto ActionResult (the page only needs the message). Revalidates even on failure: a stale mark is a store write the page must reflect. */
const lift = async (fn: () => Promise<ApplyResult>): Promise<ActionResult> => {
  try {
    const r = await fn();
    refresh();
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export async function approveAction(id: string): Promise<ActionResult> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  const store = createSupabaseLinksStore();
  return lift(async () => {
    const s = await store.getSuggestion(id);
    if (!s) return { ok: false, error: "Suggestion not found" };
    return approveSuggestion(store, { id, userId: u.id, wp: await wpFor(s.brand_id) });
  });
}

export async function undoAction(id: string): Promise<ActionResult> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  const store = createSupabaseLinksStore();
  return lift(async () => {
    const s = await store.getSuggestion(id);
    if (!s) return { ok: false, error: "Suggestion not found" };
    return undoSuggestion(store, { id, userId: u.id, wp: await wpFor(s.brand_id) });
  });
}

export async function rejectAction(id: string): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return lift(() => rejectSuggestion(createSupabaseLinksStore(), { id }));
}
