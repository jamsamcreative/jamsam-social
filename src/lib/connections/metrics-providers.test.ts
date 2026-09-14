import { describe, it, expect, vi } from "vitest";
import { ga4ConfigSchema } from "@/lib/connections/google-analytics";
import { gscConfigSchema } from "@/lib/connections/search-console";
import { metaAds } from "@/lib/connections/meta-ads";

const mock = (handler: (u: URL) => Response): typeof fetch => (async (input) => handler(new URL(String(input)))) as typeof fetch;

describe("metrics providers", () => {
  it("GA4 config parses lead_events from the hidden JSON field and requires a numeric id", () => {
    expect(ga4ConfigSchema.parse({ property_id: " 450532525 ", lead_events: '["form_submit","generate_lead"]', ads_linked: "true" })).toEqual({ property_id: "450532525", lead_events: ["form_submit", "generate_lead"], ads_linked: true });
    expect(ga4ConfigSchema.safeParse({ property_id: "G-ABC123" }).success).toBe(false);
  });
  it("GSC config accepts domain and URL-prefix properties only", () => {
    expect(gscConfigSchema.safeParse({ site_url: "sc-domain:client.com" }).success).toBe(true);
    expect(gscConfigSchema.safeParse({ site_url: "https://client.com/" }).success).toBe(true);
    expect(gscConfigSchema.safeParse({ site_url: "https://client.com" }).success).toBe(false);
    expect(gscConfigSchema.safeParse({ site_url: "client.com" }).success).toBe(false);
  });
  it("Meta Ads test reports account name and yesterday's spend and patches config", async () => {
    const f = mock((u) =>
      u.pathname.endsWith("/insights")
        ? new Response(JSON.stringify({ data: [{ date_start: "2026-09-12", date_stop: "2026-09-12", spend: "12.50" }] }))
        : new Response(JSON.stringify({ name: "JamSam Ads", currency: "USD" })),
    );
    const r = await metaAds.test({ ad_account_id: "act_1" }, { access_token: "t" }, f);
    expect(r).toMatchObject({ ok: true, configPatch: { ad_account_name: "JamSam Ads", currency: "USD" } });
    expect(r.ok && r.detail).toMatch(/12\.50/);
  });
  it("Meta Ads test surfaces Graph errors", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 400 })) as unknown as typeof fetch;
    const r = await metaAds.test({ ad_account_id: "act_1" }, { access_token: "bad" }, f);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Invalid OAuth/) });
  });
});
