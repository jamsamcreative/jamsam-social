import { describe, it, expect, vi } from "vitest";
import { semrush } from "@/lib/connections/semrush";

describe("semrush.test", () => {
  it("succeeds and reports remaining API units", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://www.semrush.com/users/countapiunits.html?key=k1");
      return new Response("48210", { status: 200 });
    });
    const r = await semrush.test({ database: "us" }, { api_key: "k1" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "48,210 API units remaining" });
  });
  it("fails when SEMrush returns an error string", async () => {
    const f = vi.fn(async () => new Response("ERROR 120 :: WRONG KEY - ID PAIR", { status: 200 }));
    const r = await semrush.test({ database: "us" }, { api_key: "bad" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "SEMrush: ERROR 120 :: WRONG KEY - ID PAIR" });
  });
});
