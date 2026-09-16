// Removes any brand created by e2e runs (slug e2e-brand-*), even if a test failed mid-way.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  await fetch(`${url}/rest/v1/posts?title=like.E2E%20post%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/articles?title=like.E2E%20article%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/generation_jobs?input->>topic=like.E2E%20topic%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/post_categories?name=like.E2E%20cat%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/keywords?keyword=like.e2e%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/pins?title=like.E2E%20pin%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/pin_boards?board_id=like.e2e-board-*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/social_history?caption=like.E2E%20history%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/projects?title=like.E2E%20project%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/brands?slug=like.e2e-brand-*`, { method: "DELETE", headers });
}
