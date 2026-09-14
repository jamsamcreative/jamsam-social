import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { encryptJson } from "@/lib/crypto";
import { verifyState } from "@/lib/meta/oauth";
import { gbpExchangeCode, gbpListLocations } from "@/lib/google/gbp";
import { getBrandBySlug } from "@/lib/brands/queries";
import type { Json } from "@/lib/database.types";

function back(slug: string, q: Record<string, string>) {
  const u = new URL(`/brands/${slug}/connections`, env.NEXT_PUBLIC_APP_URL);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));
  const p = req.nextUrl.searchParams;
  const state = verifyState(p.get("state") ?? "");
  const nonce = req.cookies.get("google_oauth_nonce")?.value;
  if (!state || !nonce || state.nonce !== nonce) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  const slug = state.brand;
  if (p.get("error")) return back(slug, { gbp_error: p.get("error_description") ?? "Google sign-in was cancelled" });
  const code = p.get("code");
  if (!code) return back(slug, { gbp_error: "No code returned" });
  try {
    const brand = await getBrandBySlug(slug);
    if (!brand) return back(slug, { gbp_error: "Brand not found" });
    const tok = await gbpExchangeCode(code, `${env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`);
    if (!tok.refresh_token) return back(slug, { gbp_error: "Google did not return a refresh token; remove the app's access at myaccount.google.com/permissions and try again" });
    const locations = await gbpListLocations({ token: tok.access_token! });
    const admin = createAdminSupabase();
    const { data: existing } = await admin.from("brand_connections").select("config").eq("brand_id", brand.id).eq("provider", "gbp").maybeSingle();
    const prev = ((existing?.config as { locations?: { name: string; enabled: boolean }[] } | null)?.locations ?? []);
    const config = { locations: locations.map((l) => ({ name: l.name, title: l.title, enabled: prev.find((x) => x.name === l.name)?.enabled ?? locations.length === 1 })) };
    const { error } = await admin
      .from("brand_connections")
      .upsert({ brand_id: brand.id, provider: "gbp", config: config as Json, secret: encryptJson({ refresh_token: tok.refresh_token }), status: "connected", last_checked: new Date().toISOString(), last_error: null }, { onConflict: "brand_id,provider" });
    if (error) throw new Error(error.message);
    const res = back(slug, { gbp_connected: String(locations.length) });
    res.cookies.delete("google_oauth_nonce");
    return res;
  } catch (e) {
    return back(slug, { gbp_error: e instanceof Error ? e.message : "Connection failed" });
  }
}
