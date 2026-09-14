import { NextResponse } from "next/server";
import { getJobPublic } from "@/lib/jobs/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobPublic(id); // RLS: an anonymous request sees nothing
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
