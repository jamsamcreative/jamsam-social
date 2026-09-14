import { test, expect } from "@playwright/test";

const stamp = Date.now();
const brandName = `E2E Brand Pins ${stamp}`;
const slug = `e2e-brand-pins-${stamp}`;

// Seeds a board through the service role so the form has something to pick (no Pinterest call is made).
async function seedBoard(brandSlug: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const brands = (await (await fetch(`${url}/rest/v1/brands?slug=eq.${brandSlug}&select=id`, { headers })).json()) as { id: string }[];
  await fetch(`${url}/rest/v1/pin_boards`, { method: "POST", headers, body: JSON.stringify({ brand_id: brands[0].id, board_id: `e2e-board-${stamp}`, name: "E2E Board", pin_count: 0 }) });
}

test("pins: draft, submit, approve with schedule, calendar, archive", async ({ page }) => {
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
  await expect(page.getByRole("combobox")).toContainText(brandName);
  await seedBoard(slug);

  await page.goto("/pins/new");
  const title = `E2E pin ${stamp}`;
  await page.getByLabel("Board").selectOption({ label: "E2E Board (0)" });
  await page.locator("#pin-image-url").fill("https://example.com/e2e.jpg");
  await page.locator("#pin-title").fill(title);
  await page.locator("#pin-desc").fill("A well written description of a test pin for the end to end suite that is long enough to be indexed as search text by Pinterest.");
  await page.locator("#pin-link").fill("https://example.com/projects/e2e");
  await page.locator("#pin-when").fill("2030-01-01T09:00");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pins\/[0-9a-f-]+$/, { timeout: 15000 });

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Awaiting approval")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Scheduled").first()).toBeVisible();

  await page.goto("/calendar?month=2030-01");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(title) }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
});
