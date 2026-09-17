"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decryptJson } from "@/lib/crypto";
import { getBrandBySlug } from "@/lib/brands/queries";
import { saveMetaPage, disconnectMeta as disconnect } from "./connect";
import { listPages } from "./oauth";

export async function choosePage(slug: string, pageId: string): Promise<void> {
  const store = await cookies();
  const raw = store.get("meta_pages")?.value;
  const brand = await getBrandBySlug(slug);
  if (!raw || !brand) redirect(`/brands/${slug}/connections?meta_error=${encodeURIComponent("Session expired, connect again")}`);
  const payload = decryptJson<{ brandId: string; me: { id: string; name: string }; userToken: string }>(raw);
  const pages = await listPages(payload.userToken);
  const page = pages.find((p) => p.id === pageId);
  if (!page || payload.brandId !== brand.id) redirect(`/brands/${slug}/connections?meta_error=${encodeURIComponent("Page not found")}`);
  await saveMetaPage(brand.id, page, payload.me);
  store.delete("meta_pages");
  revalidatePath(`/brands/${slug}/connections`);
  redirect(`/brands/${slug}/connections?meta_connected=${encodeURIComponent(page.name)}`);
}

export async function disconnectMeta(brandId: string, slug: string): Promise<void> {
  await disconnect(brandId);
  revalidatePath(`/brands/${slug}/connections`);
  revalidatePath("/brands/[slug]", "page");
}
