import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { encryptJson } from "@/lib/crypto";
import { verifyState } from "@/lib/meta/oauth";
import { exchangeCode, userAccount } from "@/lib/pinterest/client";
import { getBrandBySlug } from "@/lib/brands/queries";
import { syncBoardsForBrand } from "@/lib/pins/boards";
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
  const nonce = req.cookies.get("pinterest_oauth_nonce")?.value;
  if (!state || !nonce || state.nonce !== nonce) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  const slug = state.brand;
  if (p.get("error")) return back(slug, { pinterest_error: p.get("error_description") ?? p.get("error") ?? "Pinterest sign-in was cancelled" });
  const code = p.get("code");
  if (!code || !env.PINTEREST_APP_ID || !env.PINTEREST_APP_SECRET) return back(slug, { pinterest_error: "No code returned or app credentials missing" });
  try {
    const brand = await getBrandBySlug(slug);
    if (!brand) return back(slug, { pinterest_error: "Brand not found" });
    const tok = await exchangeCode(env.PINTEREST_APP_ID, env.PINTEREST_APP_SECRET, code, `${env.NEXT_PUBLIC_APP_URL}/api/auth/pinterest/callback`);
    const me = await userAccount(tok.access_token);
    const config = { username: me.username, account_type: me.account_type, connected_via: "oauth" };
    const { error } = await createAdminSupabase()
      .from("brand_connections")
      .upsert({ brand_id: brand.id, provider: "pinterest", config: config as Json, secret: encryptJson({ access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: tok.expires_at }), status: "connected", last_checked: new Date().toISOString(), last_error: null }, { onConflict: "brand_id,provider" });
    if (error) throw new Error(error.message);
    const boards = await syncBoardsForBrand(brand.id).catch(() => ({ boards: 0 }));
    const res = back(slug, { pinterest_connected: `@${me.username ?? "pinterest"} (${boards.boards} boards)` });
    res.cookies.delete("pinterest_oauth_nonce");
    return res;
  } catch (e) {
    return back(slug, { pinterest_error: e instanceof Error ? e.message : "Connection failed" });
  }
}
