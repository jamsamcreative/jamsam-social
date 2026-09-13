import type { z } from "zod";

export type Provider = "wordpress" | "meta" | "pinterest" | "semrush";
export const PROVIDER_LABELS: Record<Provider, string> = {
  wordpress: "WordPress",
  meta: "Meta (Facebook + Instagram)",
  pinterest: "Pinterest",
  semrush: "SEMrush",
};

export type TestResult = { ok: true; detail: string } | { ok: false; error: string };

export interface ConnectionProvider<C, S> {
  provider: Provider;
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S>;
  test(config: C, secret: S, fetchImpl?: typeof fetch): Promise<TestResult>;
}
