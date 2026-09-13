import { test, expect } from "@playwright/test";

test("compose, submit, approve, calendar, archive", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E_EMAIL / E2E_PASSWORD not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/posts/new");
  const title = `E2E post ${Date.now()}`;
  await page.getByLabel("Title (internal)").fill(title);
  await page.getByLabel("Instagram").uncheck();
  await page.locator("#cap-facebook").fill("Hello from e2e");
  await page.locator("#when-facebook").fill("2030-01-01T09:00");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]+$/, { timeout: 15000 });
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Pending approval")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Scheduled").first()).toBeVisible();

  await page.goto("/calendar?month=2030-01");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(title) }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
});
