import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { signState } from "@/lib/meta/oauth";
import { gbpAuthUrl } from "@/lib/google/gbp";

export async function GET(req: NextRequest) {
  if (env.GBP_ENABLED !== "true" || !env.GOOGLE_OAUTH_CLIENT_ID) return NextResponse.json({ error: "Google Business Profile is not enabled" }, { status: 404 });
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));
  const brand = req.nextUrl.searchParams.get("brand");
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });
  const nonce = randomBytes(16).toString("hex");
  const state = signState({ brand, nonce });
  const res = NextResponse.redirect(gbpAuthUrl({ redirectUri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`, state }));
  res.cookies.set("google_oauth_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: env.NEXT_PUBLIC_APP_URL.startsWith("https"), path: "/", maxAge: 600 });
  return res;
}
