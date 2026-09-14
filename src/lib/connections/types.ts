import type { z } from "zod";

export type Provider = "wordpress" | "meta" | "meta_ads" | "google_analytics" | "search_console" | "pinterest" | "semrush" | "gbp";
export const PROVIDER_LABELS: Record<Provider, string> = {
  wordpress: "WordPress",
  meta: "Meta (Facebook + Instagram)",
  meta_ads: "Meta Ads",
  google_analytics: "Google Analytics 4",
  search_console: "Google Search Console",
  pinterest: "Pinterest",
  semrush: "SEMrush",
  gbp: "Google Business Profile",
};

/** `configPatch` lets a successful test write discovered facts (property name, ads link) back onto the saved config. */
export type TestResult = { ok: true; detail: string; configPatch?: Record<string, unknown> } | { ok: false; error: string };

export interface ConnectionProvider<C, S> {
  provider: Provider;
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S>;
  test(config: C, secret: S, fetchImpl?: typeof fetch): Promise<TestResult>;
}
