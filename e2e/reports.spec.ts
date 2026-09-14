import { test, expect } from "@playwright/test";

const stamp = Date.now();
const brandName = `E2E Brand Reports ${stamp}`;
const slug = `e2e-brand-reports-${stamp}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

test("reports: empty state, then seeded metrics render tiles and tables", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL || !key, "E2E env not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/brands/new");
  await page.getByLabel("Client name").fill(brandName);
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page).toHaveURL(new RegExp(`/brands/${slug}$`));
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: brandName }).click();
  await expect(page.getByRole("combobox")).toContainText(brandName);

  await page.goto("/reports");
  await expect(page.getByText("No marketing data for this range yet")).toBeVisible();

  // Seed 3 days of totals via the service role (cascade-deleted with the e2e brand by global teardown)
  const brandRes = await fetch(`${url}/rest/v1/brands?slug=eq.${slug}&select=id`, { headers });
  const [{ id: brandId }] = (await brandRes.json()) as { id: string }[];
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const rows = [1, 2, 3].flatMap((n) => [
    { brand_id: brandId, source: "meta_ads_total", date: day(n), dim: "_", metrics: { spend: 100, clicks: 50, impressions: 1000, link_clicks: 40, leads: 2 } },
    { brand_id: brandId, source: "ga4_total", date: day(n), dim: "_", metrics: { sessions: 500, google_ads_cost: 0, google_ads_clicks: 0, leads: 5 } },
    { brand_id: brandId, source: "ga4_channel", date: day(n), dim: "Organic Search", metrics: { sessions: 300, engaged_sessions: 200, leads: 4 } },
    { brand_id: brandId, source: "gsc_total", date: day(n), dim: "_", metrics: { clicks: 10, impressions: 200, ctr: 0.05, position: 8 } },
  ]);
  const ins = await fetch(`${url}/rest/v1/metrics_daily`, { method: "POST", headers, body: JSON.stringify(rows) });
  expect(ins.ok).toBe(true);

  await page.goto("/reports?tab=overview&range=30d");
  await expect(page.getByText("Ad spend")).toBeVisible();
  await expect(page.getByText("$300", { exact: true }).first()).toBeVisible(); // 3 × $100 (tile + table)
  await expect(page.getByText("15", { exact: true }).first()).toBeVisible(); // website leads
  await expect(page.getByText("Organic Search").first()).toBeVisible();
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.getByText("30", { exact: true }).first()).toBeVisible(); // 3 × 10 clicks
  await page.getByRole("link", { name: "Content & social" }).click();
  await expect(page.getByText("No published posts in this range.")).toBeVisible();
});
