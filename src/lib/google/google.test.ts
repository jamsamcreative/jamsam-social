import { describe, it, expect } from "vitest";
import { serviceAccount } from "@/lib/google/auth";
import { ga4RunReport } from "@/lib/google/ga4";
import { gscQuery } from "@/lib/google/gsc";
import { GoogleApiError } from "@/lib/google/api";

const mock = (handler: (u: URL, init?: RequestInit) => Response): typeof fetch => (async (input, init) => handler(new URL(String(input)), init)) as typeof fetch;

describe("google clients", () => {
  it("serviceAccount parses the env JSON and unescapes the key", () => {
    expect(serviceAccount(undefined)).toBeNull();
    expect(serviceAccount("not json")).toBeNull();
    const sa = serviceAccount(JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: "-----BEGIN\\nabc\\n-----END", project_id: "p" }));
    expect(sa?.email).toBe("sa@x.iam.gserviceaccount.com");
    expect(sa?.key).toContain("\n");
  });
  it("ga4RunReport maps rows to numbers and sends the bearer token", async () => {
    const f = mock((u, init) => {
      expect(u.pathname).toBe("/v1beta/properties/123:runReport");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify({ dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }], rows: [{ dimensionValues: [{ value: "20260901" }], metricValues: [{ value: "42" }] }] }));
    });
    const r = await ga4RunReport("123", { dateRanges: [{ startDate: "2026-09-01", endDate: "2026-09-01" }], metrics: [{ name: "sessions" }] }, { token: "tok", fetchImpl: f });
    expect(r).toEqual({ dimensionHeaders: ["date"], metricHeaders: ["sessions"], rows: [{ dims: ["20260901"], metrics: [42] }] });
  });
  it("surfaces Google errors with status and reason", async () => {
    const f = mock(() => new Response(JSON.stringify({ error: { message: "User does not have sufficient permissions", status: "PERMISSION_DENIED" } }), { status: 403 }));
    await expect(ga4RunReport("1", { dateRanges: [], metrics: [] }, { token: "t", fetchImpl: f })).rejects.toMatchObject({ status: 403, reason: "PERMISSION_DENIED" });
    await expect(ga4RunReport("1", { dateRanges: [], metrics: [] }, { token: "t", fetchImpl: f })).rejects.toBeInstanceOf(GoogleApiError);
  });
  it("gscQuery encodes the site URL and parses rows", async () => {
    const f = mock((u) => {
      expect(u.pathname).toBe("/webmasters/v3/sites/sc-domain%3Aclient.com/searchAnalytics/query");
      return new Response(JSON.stringify({ rows: [{ keys: ["2026-09-01"], clicks: 5, impressions: 100, ctr: 0.05, position: 12.3 }] }));
    });
    const r = await gscQuery("sc-domain:client.com", { startDate: "2026-09-01", endDate: "2026-09-01", dimensions: ["date"] }, { token: "t", fetchImpl: f });
    expect(r.rows[0]).toEqual({ keys: ["2026-09-01"], clicks: 5, impressions: 100, ctr: 0.05, position: 12.3 });
  });
});
