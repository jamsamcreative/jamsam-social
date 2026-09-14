import { registerClient } from "@/lib/oauth/server";
import { createSupabaseOauthStore } from "@/lib/oauth/store";
import { json, oauthErrorResponse, preflight } from "@/lib/oauth/http";

export async function POST(req: Request) {
  try {
    return json(await registerClient(createSupabaseOauthStore(), await req.json().catch(() => ({}))), 201);
  } catch (e) {
    return oauthErrorResponse(e);
  }
}
export const OPTIONS = preflight;
