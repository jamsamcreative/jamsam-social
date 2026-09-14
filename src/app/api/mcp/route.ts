import { env } from "@/lib/env";
import { createSupabaseStore } from "@/lib/ai/store";
import { handleMcpRequest } from "@/lib/ai/mcp-server";

export const maxDuration = 60;

const handler = (req: Request) => handleMcpRequest(req, { store: createSupabaseStore(), token: env.MCP_TOKEN });
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
