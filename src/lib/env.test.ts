import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CONNECTIONS_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  META_APP_ID: "123",
  META_APP_SECRET: "shh",
  CRON_SECRET: "test-cron-secret-0000",
};

describe("parseEnv", () => {
  it("accepts a complete env", () => {
    expect(parseEnv(good).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });
  it("fails fast with a clear message when the encryption key is missing", () => {
    const { CONNECTIONS_ENCRYPTION_KEY: _drop, ...rest } = good;
    void _drop;
    expect(() => parseEnv(rest)).toThrow(/CONNECTIONS_ENCRYPTION_KEY/);
  });
  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => parseEnv({ ...good, CONNECTIONS_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/32 bytes/);
  });
});
