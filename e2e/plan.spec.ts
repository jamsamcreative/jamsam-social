import { test, expect } from "@playwright/test";

const stamp = Date.now();
const brandName = `E2E Brand Plan ${stamp}`;
const slug = `e2e-brand-plan-${stamp}`;

async function seed(brandSlug: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const [b] = (await (await fetch(`${url}/rest/v1/brands?slug=eq.${brandSlug}&select=id`, { headers })).json()) as { id: string }[];
  await fetch(`${url}/rest/v1/projects`, { method: "POST", headers, body: JSON.stringify([1, 2, 3].map((i) => ({ brand_id: b.id, title: `E2E project ${stamp}-${i}`, url: `https://example.com/e2e/${stamp}/${i}`, category: "Shops", state: "WA", images: [{ url: "https://example.com/e2e.jpg" }] }))) });
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
  await fetch(`${url}/rest/v1/social_history`, { method: "POST", headers, body: JSON.stringify({ brand_id: b.id, platform: "facebook", external_id: `e2e-${stamp}`, published_at: old, caption: `E2E history ${stamp}`, media: [{ url: "https://example.com/h.jpg", kind: "image" }], likes: 50 }) });
}

test("plan: schedule, build week, nothing auto-approved, approve day, calendar", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "E2E env not set");
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
  await seed(slug);

  await page.getByLabel("Facebook Mon").fill("15:30");
  await page.getByLabel("Instagram Mon").fill("17:30");
  await page.getByLabel("Facebook Wed").fill("15:30");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Schedule saved")).toBeVisible();

  await page.goto("/plan?week=2030-01-07");
  await page.getByRole("button", { name: "Build this week" }).click();
  await expect(page.getByText(/Built 2 posts/)).toBeVisible();
  await expect(page.getByText("0 of 2 approved")).toBeVisible();
  await expect(page.getByText("Waiting on Claude").first()).toBeVisible();
  await expect(page.getByText("Ready to approve")).toBeVisible(); // the recycle
  await expect(page.getByText("Approved", { exact: true })).toHaveCount(0);

  // Approve the recycle's day; the draft (no caption) must stay unapproved.
  // Selector uses "Ready to approve" (not "Recycle") to stay strict-mode safe if more than
  // one day section ever contained a recycle-lane badge.
  const recycleDay = page.locator("section", { hasText: "Ready to approve" }).first();
  await recycleDay.getByRole("button", { name: "Approve day" }).click();
  await expect(page.getByText("1 of 2 approved")).toBeVisible();

  await page.goto("/calendar?month=2030-01");
  await expect(page.getByText(/Re-run: E2E history/).first()).toBeVisible();
});
