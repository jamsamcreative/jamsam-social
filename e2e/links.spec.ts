import { test, expect } from "@playwright/test";

const stamp = Date.now();
const brandName = `E2E Brand Links ${stamp}`;
const slug = `e2e-brand-links-${stamp}`;
const phrase = "pole barn kits";
const context = "Our pole barn kits ship fast.";

async function seed(brandSlug: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const repHeaders = { ...headers, Prefer: "return=representation" };
  const [b] = (await (await fetch(`${url}/rest/v1/brands?slug=eq.${brandSlug}&select=id`, { headers })).json()) as { id: string }[];

  const pages = (await (
    await fetch(`${url}/rest/v1/site_pages`, {
      method: "POST",
      headers: repHeaders,
      body: JSON.stringify([
        { brand_id: b.id, type: "post", wp_id: 9001, slug: `e2e-page-host-${stamp}`, url: `https://example.com/e2e/${stamp}/host`, title: `E2E page host ${stamp}`, content_text: context },
        { brand_id: b.id, type: "post", wp_id: 9002, slug: `e2e-page-orphan-${stamp}`, url: `https://example.com/e2e/${stamp}/orphan`, title: `E2E page orphan ${stamp}`, content_text: "Nothing links here yet." },
        { brand_id: b.id, type: "post", wp_id: 9003, slug: `e2e-page-none-${stamp}`, url: `https://example.com/e2e/${stamp}/none`, title: `E2E page none ${stamp}`, content_text: "A page nothing else mentions." },
      ]),
    })
  ).json()) as { id: string; wp_id: number }[];
  const host = pages.find((p) => p.wp_id === 9001)!;
  const orphan = pages.find((p) => p.wp_id === 9002)!;
  const noneOrphan = pages.find((p) => p.wp_id === 9003)!;

  // Two separate inserts: PostgREST rejects a single bulk-insert array whose objects don't share identical keys.
  await fetch(`${url}/rest/v1/link_suggestions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ brand_id: b.id, orphan_page_id: orphan.id, host_page_id: host.id, phrase, context, status: "pending" }),
  });
  await fetch(`${url}/rest/v1/link_suggestions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ brand_id: b.id, orphan_page_id: noneOrphan.id, host_page_id: null, status: "none", reason: "no other post mentions the topic", phrases_tried: ["thing one", "thing two"] }),
  });
}

test("links: review flow — awaiting review, reject, no-suggestion card", async ({ page }) => {
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

  await page.goto(`/blog/links?brand=${slug}`);

  // Stat tile: "Awaiting review" shows 1. Scoped to the stat card's content div, since the
  // "Awaiting review" section heading below repeats the same string.
  const pendingTile = page.locator('[data-slot="card-content"]', { has: page.getByText("Awaiting review", { exact: true }) });
  await expect(pendingTile.locator("p").nth(1)).toHaveText("1");

  // The pending suggestion card shows the context with the phrase.
  await expect(page.getByText(context)).toBeVisible();

  // Reject it — empty state appears.
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Nothing to approve. The orphaned posts below need a link written by hand.")).toBeVisible();

  // The no-suggestion card: heading, reason headline, and (after opening details) a tried phrase.
  await expect(page.getByRole("heading", { name: "Orphaned with no suggestion (1)" })).toBeVisible();
  await expect(page.getByText("No other article mentions the topic")).toBeVisible();
  await page.getByText("Phrases tried (2)").click();
  await expect(page.getByText("thing one")).toBeVisible();
});
