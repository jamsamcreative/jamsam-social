import { test, expect } from "@playwright/test";

const stamp = Date.now();
const brandName = `E2E Brand Jobs ${stamp}`;
const slug = `e2e-brand-jobs-${stamp}`;

test("content-mix category, queue an MCP article job, cancel it", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E_EMAIL / E2E_PASSWORD not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Own brand, so category targets start at 0% (teardown removes e2e-brand-*).
  await page.goto("/brands/new");
  await page.getByLabel("Client name").fill(brandName);
  await expect(page.getByLabel("Slug")).toHaveValue(slug);
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page).toHaveURL(new RegExp(`/brands/${slug}$`));
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: brandName }).click();
  await expect(page.getByRole("combobox")).toContainText(brandName);

  await page.goto(`/brands/${slug}/content-mix`);
  const catName = `E2E cat ${stamp}`;
  const newRow = page.locator("form").last();
  await newRow.getByLabel("Name").fill(catName);
  await newRow.getByLabel("Target %").fill("40");
  await newRow.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(`input[value="${catName}"]`)).toBeVisible();
  await expect(page.getByText(/Next post should favour/)).toBeVisible();

  // Queue an MCP job from the articles page; it must not run (no external agent)
  await page.goto("/blog");
  await page.getByRole("button", { name: /New from brief/ }).click();
  await page.getByLabel("Topic").fill(`E2E topic ${stamp}`);
  await page.getByLabel("Runner").selectOption("mcp");
  await page.getByRole("button", { name: "Write blog post" }).click();
  await expect(page).toHaveURL(/\/jobs/);
  const row = page.getByRole("row").filter({ hasText: "Article" }).filter({ hasText: "Queued" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Cancelled" }).first()).toBeVisible();
});
