import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { buildAuthUrl, signState } from "@/lib/meta/oauth";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));
  const brand = req.nextUrl.searchParams.get("brand");
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  const nonce = randomBytes(16).toString("hex");
  const state = signState({ brand, nonce });
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`;
  const res = NextResponse.redirect(buildAuthUrl({ redirectUri, state }));
  res.cookies.set("meta_oauth_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: env.NEXT_PUBLIC_APP_URL.startsWith("https"), path: "/", maxAge: 600 });
  return res;
}
