import { NextResponse } from "next/server";
import { OauthError } from "./server";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...CORS, ...headers } });
}

export function oauthErrorResponse(e: unknown) {
  if (e instanceof OauthError) return json({ error: e.code, error_description: e.message }, e.status);
  return json({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, 500);
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Token/register bodies arrive as JSON or form-encoded depending on the client. */
export async function readBody(req: Request): Promise<Record<string, string | undefined>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await req.json()) as Record<string, string | undefined>;
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text)) as Record<string, string | undefined>;
}
