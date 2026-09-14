import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcpRequest } from "@/lib/ai/mcp-server";
import { fakeStore } from "@/lib/ai/fake-store";

const TOKEN = "test-mcp-token-0000000000000000000000";
function fetchVia(store = fakeStore()): typeof fetch {
  return (input, init) => handleMcpRequest(new Request(input, init), { store, token: TOKEN });
}
async function connect(headers: Record<string, string>) {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://app.test/api/mcp"), { fetch: fetchVia(), requestInit: { headers } });
  await client.connect(transport);
  return client;
}

describe("MCP server", () => {
  it("rejects a missing or wrong token with 401", async () => {
    const res = await handleMcpRequest(new Request("http://app.test/api/mcp", { method: "POST", body: "{}" }), { store: fakeStore(), token: TOKEN });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
    await expect(connect({ Authorization: "Bearer nope" })).rejects.toThrow();
  });
  it("lists every registry tool and calls list_brands", async () => {
    const client = await connect({ Authorization: `Bearer ${TOKEN}` });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "claim_job", "complete_job", "create_article", "create_post", "get_article", "get_brand_guidelines", "get_content_mix", "list_articles",
      "list_brands", "list_jobs", "list_media_assets", "list_posts", "search_wp_media", "submit_captions", "update_article",
    ]);
    const r = await client.callTool({ name: "list_brands", arguments: {} });
    expect(JSON.parse((r.content as { text: string }[])[0].text)[0].slug).toBe("acme");
  });
  it("returns tool errors as isError results, not protocol errors", async () => {
    const client = await connect({ Authorization: `Bearer ${TOKEN}` });
    const r = await client.callTool({ name: "get_brand_guidelines", arguments: { brand: "nope" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/Unknown brand/);
  });
  it("GET is 405", async () => {
    const res = await handleMcpRequest(new Request("http://app.test/api/mcp", { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } }), { store: fakeStore(), token: TOKEN });
    expect(res.status).toBe(405);
  });
});
