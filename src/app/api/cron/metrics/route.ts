import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runMetricsCycle } from "@/lib/metrics/run";
import { runSeoCycle } from "@/lib/seo/run";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const metrics = await runMetricsCycle();
    const seo = await runSeoCycle();
    return NextResponse.json({ metrics, seo });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
