import { test, expect } from "@playwright/test";

test("create article, save, list, archive", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E_EMAIL / E2E_PASSWORD not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/blog/new");
  const title = `E2E article ${Date.now()}`;
  await page.getByLabel("Title (H1)").fill(title);
  await expect(page.getByLabel("Slug")).toHaveValue(/^e2e-article-\d+$/);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Body paragraph.");
  await page.getByRole("button", { name: "Create blog post" }).click();
  await expect(page).toHaveURL(/\/blog\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  await page.goto("/blog");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
});
