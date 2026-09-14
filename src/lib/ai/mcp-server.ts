import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { allTools } from "./tools/registry";
import { ToolError, type ToolCtx } from "./tools/types";
import type { Store } from "./store";

function tokenOk(req: Request, want: string): boolean {
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export function createMcpServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: "jamsam-social", version: "1.0.0" });
  for (const tool of allTools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input.shape }, async (args) => {
      try {
        const clientName = server.server.getClientVersion()?.name;
        const out = await tool.run({ ...ctx, actor: { ...ctx.actor, clientName: clientName ?? ctx.actor.clientName } }, args);
        return { content: [{ type: "text", text: JSON.stringify(out ?? null) }] };
      } catch (e) {
        if (e instanceof ToolError) return { isError: true, content: [{ type: "text", text: e.message }] };
        throw e;
      }
    });
  }
  return server;
}

/** Stateless: a fresh server + transport per request, no session ids. POST only. */
export async function handleMcpRequest(req: Request, deps: { store: Store; token: string }): Promise<Response> {
  if (!tokenOk(req, deps.token)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="jamsam-social"', "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  const server = createMcpServer({ store: deps.store, actor: { kind: "mcp" } });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close().catch(() => {});
  }
}
