"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const COOKIE = "jamsam_brand";

export async function getCurrentBrandSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

export async function setCurrentBrand(slug: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, slug, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
