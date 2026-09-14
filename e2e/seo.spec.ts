import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stamp = Date.now();
const brandName = `E2E Brand SEO ${stamp}`;
const slug = `e2e-brand-seo-${stamp}`;

test("seo: import keywords CSV, see opportunities, Write this prefills the brief", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E env not set");
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

  const csv = join(tmpdir(), `e2e-keywords-${stamp}.csv`);
  writeFileSync(csv, "Keyword,Search Volume,KD,Intent,Cluster\nE2E horse barns,3600,39,Commercial,Agricultural\nE2E barn kits,590,8,Commercial,Barndos\n");
  await page.goto("/seo?tab=imports");
  await page.getByLabel("Keywords CSV").setInputFiles(csv);
  await page.locator("form").filter({ hasText: "Keywords CSV" }).getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported 2 keywords")).toBeVisible();

  await page.goto("/seo?tab=opportunities");
  await expect(page.getByText("e2e horse barns")).toBeVisible();
  await expect(page.getByText("NEW", { exact: true }).first()).toBeVisible();
  await page.getByRole("row").filter({ hasText: "e2e horse barns" }).getByRole("button", { name: "Write this" }).click();
  await expect(page).toHaveURL(/\/articles\?brief=/);
  await expect(page.getByLabel("Topic")).toHaveValue("e2e horse barns");
  await expect(page.getByLabel("Notes")).toHaveValue(/Topic cluster: Agricultural/);
});
