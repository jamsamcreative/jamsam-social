import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { signState } from "@/lib/meta/oauth";
import { pinterestAuthUrl } from "@/lib/pinterest/client";

export async function GET(req: NextRequest) {
  if (!env.PINTEREST_APP_ID) return NextResponse.json({ error: "PINTEREST_APP_ID is not configured" }, { status: 404 });
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));
  const brand = req.nextUrl.searchParams.get("brand");
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });
  const nonce = randomBytes(16).toString("hex");
  const state = signState({ brand, nonce });
  const res = NextResponse.redirect(pinterestAuthUrl({ appId: env.PINTEREST_APP_ID, redirectUri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/pinterest/callback`, state }));
  res.cookies.set("pinterest_oauth_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: env.NEXT_PUBLIC_APP_URL.startsWith("https"), path: "/", maxAge: 600 });
  return res;
}
