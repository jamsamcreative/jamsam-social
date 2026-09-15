import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runInsightsCycle } from "@/lib/insights/run";
import { runPinInsightsCycle } from "@/lib/insights/pins";
import { topUpHistoryForAllBrands } from "@/lib/plan/history-sync";
import { createSupabasePlanStore } from "@/lib/plan/store";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const posts = await runInsightsCycle();
    const pins = await runPinInsightsCycle();
    const history = await topUpHistoryForAllBrands(createSupabasePlanStore());
    return NextResponse.json({ ...posts, pins, history });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
