import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildHelperZip } from "@/lib/wordpress/helper-plugin";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const buf = await buildHelperZip();
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="jamsam-connector.zip"' },
  });
}
