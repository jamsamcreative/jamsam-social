import { describe, it, expect, vi } from "vitest";
import { wordpress } from "@/lib/connections/wordpress";

const cfg = { site_url: "https://client.com/", username: "jamie" };
const sec = { app_password: "abcd efgh ijkl" };

describe("wordpress.test", () => {
  it("succeeds and reports the user name and role", async () => {
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://client.com/wp-json/wp/v2/users/me?context=edit");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Basic " + Buffer.from("jamie:abcd efgh ijkl").toString("base64"),
      );
      return new Response(JSON.stringify({ name: "Jamie", roles: ["administrator"] }), { status: 200 });
    });
    const r = await wordpress.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Signed in as Jamie (administrator)" });
  });
  it("fails with a readable message on 401", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: "Sorry, you are not allowed" }), { status: 401 }));
    const r = await wordpress.test(cfg, sec, f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/401/);
  });
  it("fails when fetch throws", async () => {
    const f = vi.fn(async () => {
      throw new Error("Request timed out after 10s");
    });
    const r = await wordpress.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "Request timed out after 10s" });
  });
});

describe("wordpress.test non-JSON responses", () => {
  it("explains when the site returns HTML instead of the REST API", async () => {
    const f = vi.fn(async () => new Response("<!DOCTYPE html><html>...</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const r = await wordpress.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "WordPress did not return JSON (got text/html). Check the site URL and that the REST API is enabled." });
  });
});
