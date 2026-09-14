import { exchangeToken } from "@/lib/oauth/server";
import { createSupabaseOauthStore } from "@/lib/oauth/store";
import { json, oauthErrorResponse, preflight, readBody } from "@/lib/oauth/http";

export async function POST(req: Request) {
  try {
    return json(await exchangeToken(createSupabaseOauthStore(), await readBody(req)));
  } catch (e) {
    return oauthErrorResponse(e);
  }
}
export const OPTIONS = preflight;
