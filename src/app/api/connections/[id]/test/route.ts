import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runConnectionTest } from "@/lib/connections/actions";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await runConnectionTest(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
