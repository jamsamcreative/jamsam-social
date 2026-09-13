import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { encryptJson } from "@/lib/crypto";
import { verifyState, exchangeCode, listPages, getMe } from "@/lib/meta/oauth";
import { saveMetaPage } from "@/lib/meta/connect";
import { getBrandBySlug } from "@/lib/brands/queries";

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
  const nonce = req.cookies.get("meta_oauth_nonce")?.value;
  if (!state || !nonce || state.nonce !== nonce) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  const slug = state.brand;

  if (p.get("error")) return back(slug, { meta_error: p.get("error_description") ?? "Facebook login was cancelled" });
  const code = p.get("code");
  if (!code) return back(slug, { meta_error: "No code returned" });

  try {
    const brand = await getBrandBySlug(slug);
    if (!brand) return back(slug, { meta_error: "Brand not found" });
    const token = await exchangeCode({ code, redirectUri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback` });
    const [me, pages] = await Promise.all([getMe(token), listPages(token)]);
    if (pages.length === 0) return back(slug, { meta_error: "This Facebook account has no Pages you manage" });

    if (pages.length === 1) {
      await saveMetaPage(brand.id, pages[0], me);
      return back(slug, { meta_connected: pages[0].name });
    }
    const res = NextResponse.redirect(new URL(`/brands/${slug}/connections/meta/pick`, env.NEXT_PUBLIC_APP_URL));
    // Only the (single) user token goes in the cookie; the picker re-lists Pages. Page tokens are too big for a cookie.
    res.cookies.set("meta_pages", encryptJson({ brandId: brand.id, me, userToken: token }), {
      httpOnly: true, sameSite: "lax", secure: env.NEXT_PUBLIC_APP_URL.startsWith("https"), path: "/", maxAge: 600,
    });
    res.cookies.delete("meta_oauth_nonce");
    return res;
  } catch (e) {
    return back(slug, { meta_error: e instanceof Error ? e.message : "Connection failed" });
  }
}
