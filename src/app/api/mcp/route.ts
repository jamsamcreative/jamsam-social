import { env } from "@/lib/env";
import { createSupabaseStore } from "@/lib/ai/store";
import { handleMcpRequest } from "@/lib/ai/mcp-server";
import { createSupabaseOauthStore } from "@/lib/oauth/store";
import { verifyAccessToken } from "@/lib/oauth/server";

export const maxDuration = 60;

const handler = (req: Request) =>
  handleMcpRequest(req, {
    store: createSupabaseStore(),
    token: env.MCP_TOKEN,
    origin: env.NEXT_PUBLIC_APP_URL,
    verifyOauth: (t) => verifyAccessToken(createSupabaseOauthStore(), t),
  });
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = () =>
  new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version, mcp-session-id" } });
