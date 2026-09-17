import { test, expect } from "@playwright/test";
import path from "node:path";

const email = process.env.E2E_EMAIL!;
const password = process.env.E2E_PASSWORD!;
const stamp = Date.now();
const brandName = `E2E Brand ${stamp}`;
const slug = `e2e-brand-${stamp}`;

test.describe.configure({ mode: "serial" });

test("redirects anonymous users to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("JamSam Digital team access only.")).toBeVisible();
});

test("login, create brand, upload image, see it in library", async ({ page }) => {
  test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/brands/new");
  await page.getByLabel("Client name").fill(brandName);
  await expect(page.getByLabel("Slug")).toHaveValue(slug);
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page).toHaveURL(new RegExp(`/brands/${slug}$`));
  await expect(page.getByRole("heading", { name: brandName })).toBeVisible();

  // Select the new brand in the header, then upload.
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: brandName }).click();
  await expect(page.getByRole("combobox")).toContainText(brandName);
  await page.waitForTimeout(500);
  await page.goto("/media");
  await expect(page.getByText(`${brandName} library`)).toBeVisible();
  await page.getByLabel("Images").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));
  await page.getByLabel("Alt text (applied to all)").fill("e2e pixel");
  await page.getByLabel("Tags (comma separated)").fill("e2e");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("button", { name: /e2e pixel/ })).toBeVisible();

  // Cleanup: delete the asset, archive the brand.
  await page.getByRole("button", { name: /e2e pixel/ }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No images yet")).toBeVisible();

  await page.goto(`/brands/${slug}/settings`);
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
});
