import { describe, it, expect, vi } from "vitest";
import { graphFetch, GraphError } from "@/lib/meta/graph";

describe("graphFetch", () => {
  it("GETs with token and params", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/v21.0/123");
      expect(u.searchParams.get("fields")).toBe("name");
      expect(u.searchParams.get("access_token")).toBe("tok");
      return new Response(JSON.stringify({ name: "Page" }), { status: 200 });
    });
    expect(await graphFetch<{ name: string }>("/123", { token: "tok", params: { fields: "name" }, fetchImpl: f as unknown as typeof fetch })).toEqual({ name: "Page" });
  });
  it("POSTs form-encoded with JSON-encoded arrays", async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("message")).toBe("hi");
      expect(body.get("attached_media")).toBe('[{"media_fbid":"1"}]');
      expect(body.get("access_token")).toBe("tok");
      return new Response(JSON.stringify({ id: "9" }), { status: 200 });
    });
    expect(
      await graphFetch("/p/feed", { token: "tok", method: "POST", body: { message: "hi", attached_media: [{ media_fbid: "1" }] }, fetchImpl: f as unknown as typeof fetch }),
    ).toEqual({ id: "9" });
  });
  it("throws GraphError with the API message", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 }));
    await expect(graphFetch("/x", { token: "t", fetchImpl: f as unknown as typeof fetch })).rejects.toMatchObject({ name: "GraphError", code: 190, message: "Invalid OAuth access token" });
    await expect(graphFetch("/x", { token: "t", fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(GraphError);
  });
});
