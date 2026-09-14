import { test, expect } from "@playwright/test";

test("content-mix category, queue an MCP article job, cancel it", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E_EMAIL / E2E_PASSWORD not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Category on the current brand
  await page.goto("/brands");
  await page.locator("main a[href^='/brands/']:not([href='/brands/new'])").first().click();
  await page.getByRole("link", { name: "Content mix" }).click();
  const catName = `E2E cat ${Date.now()}`;
  const newRow = page.locator("form").last();
  await newRow.getByLabel("Name").fill(catName);
  await newRow.getByLabel("Target %").fill("5");
  await newRow.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(`input[value="${catName}"]`)).toBeVisible();

  // Queue an MCP job from the articles page
  await page.goto("/articles");
  await page.getByRole("button", { name: /New from brief/ }).click();
  const topic = `E2E topic ${Date.now()}`;
  await page.getByLabel("Topic").fill(topic);
  await page.getByLabel("Runner").selectOption("mcp");
  await page.getByRole("button", { name: "Write article" }).click();
  await expect(page).toHaveURL(/\/jobs/);
  const row = page.getByRole("row").filter({ hasText: "Article" }).filter({ hasText: "Queued" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Cancelled" }).first()).toBeVisible();

  // Clean the category
  await page.goto("/brands");
  await page.locator("main a[href^='/brands/']:not([href='/brands/new'])").first().click();
  await page.getByRole("link", { name: "Content mix" }).click();
  const form = page.locator("form").filter({ has: page.locator(`input[value="${catName}"]`) });
  await form.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(`input[value="${catName}"]`)).toHaveCount(0);
});
