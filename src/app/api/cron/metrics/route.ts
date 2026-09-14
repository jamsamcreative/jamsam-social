import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runMetricsCycle } from "@/lib/metrics/run";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runMetricsCycle());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
