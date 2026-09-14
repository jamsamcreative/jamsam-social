import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runPublishCycle } from "@/lib/publishers/run";
import { runPinPublishCycle } from "@/lib/publishers/pins";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const posts = await runPublishCycle();
    const pins = await runPinPublishCycle();
    return NextResponse.json({ ...posts, pins });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
