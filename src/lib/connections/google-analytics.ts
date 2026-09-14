import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { errorMessage } from "./http";
import { serviceAccount, googleAccessToken, GA4_SCOPE } from "@/lib/google/auth";
import { ga4RunReport, ga4PropertyName } from "@/lib/google/ga4";
import { GoogleApiError } from "@/lib/google/api";

const listFromForm = (v: unknown) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      if (Array.isArray(j)) return j;
    } catch {}
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

export const ga4ConfigSchema = z.object({
  property_id: z.string().trim().regex(/^\d+$/, "GA4 property ID is the numeric ID from Admin → Property settings"),
  lead_events: z.preprocess(listFromForm, z.array(z.string()).default([])),
  property_name: z.string().optional(),
  ads_linked: z.preprocess((v) => v === true || v === "true", z.boolean().optional()),
});
export const ga4SecretSchema = z.object({});
export type Ga4Config = z.infer<typeof ga4ConfigSchema>;

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

export const googleAnalytics: ConnectionProvider<Ga4Config, Record<string, never>> = {
  provider: "google_analytics",
  configSchema: ga4ConfigSchema,
  secretSchema: ga4SecretSchema as z.ZodType<Record<string, never>>,
  async test(config, _secret, fetchImpl = fetch): Promise<TestResult> {
    const sa = serviceAccount();
    if (!sa) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not configured on the server" };
    try {
      const token = await googleAccessToken([GA4_SCOPE]);
      const deps = { token, fetchImpl };
      const day = yesterday();
      const r = await ga4RunReport(config.property_id, { dateRanges: [{ startDate: day, endDate: day }], metrics: [{ name: "sessions" }] }, deps);
      const sessions = r.rows[0]?.metrics[0] ?? 0;
      let ads_linked = false;
      try {
        const a = await ga4RunReport(config.property_id, { dateRanges: [{ startDate: "30daysAgo", endDate: day }], metrics: [{ name: "advertiserAdCost" }] }, deps);
        ads_linked = (a.rows[0]?.metrics[0] ?? 0) > 0;
      } catch {
        ads_linked = false;
      }
      const property_name = await ga4PropertyName(config.property_id, deps);
      return {
        ok: true,
        detail: `${property_name ?? `Property ${config.property_id}`}: ${sessions} sessions yesterday. Google Ads: ${ads_linked ? "linked (spend found)" : "no spend in the last 30 days or not linked"}. Lead events: ${config.lead_events.length ? config.lead_events.join(", ") : "none chosen yet"}`,
        configPatch: { property_name: property_name ?? undefined, ads_linked },
      };
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 403) return { ok: false, error: `Google denied access. In GA4 → Admin → Property access management, add ${sa.email} as Viewer.` };
      if (e instanceof GoogleApiError && e.status === 404) return { ok: false, error: `Property ${config.property_id} not found. Use the numeric property ID from GA4 Admin → Property settings.` };
      return { ok: false, error: errorMessage(e) };
    }
  },
};
