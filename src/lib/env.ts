import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CONNECTIONS_ENCRYPTION_KEY: z
    .string({ error: "CONNECTIONS_ENCRYPTION_KEY is required (openssl rand -base64 32)" })
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "CONNECTIONS_ENCRYPTION_KEY must decode to exactly 32 bytes",
    }),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 chars (openssl rand -hex 32)"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(), // only needed for the in-app (API) runner
  MCP_TOKEN: z.string().min(32, "MCP_TOKEN must be at least 32 chars (openssl rand -base64 32)"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return result.data;
}

// Server-only. Browser code must read process.env.NEXT_PUBLIC_* directly.
export const env: Env = parseEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  CONNECTIONS_ENCRYPTION_KEY: process.env.CONNECTIONS_ENCRYPTION_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  CRON_SECRET: process.env.CRON_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  MCP_TOKEN: process.env.MCP_TOKEN,
});
