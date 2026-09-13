// Removes any brand created by e2e runs (slug e2e-brand-*), even if a test failed mid-way.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/brands?slug=like.e2e-brand-*`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
}
