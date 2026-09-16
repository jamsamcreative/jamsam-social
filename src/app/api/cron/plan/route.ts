import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runPlanCycle } from "@/lib/plan/cron";
import { createSupabasePlanStore } from "@/lib/plan/store";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runPlanCycle(createSupabasePlanStore()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
