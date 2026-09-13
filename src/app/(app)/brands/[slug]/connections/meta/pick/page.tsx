import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { decryptJson } from "@/lib/crypto";
import { getBrandBySlug } from "@/lib/brands/queries";
import { listPages } from "@/lib/meta/oauth";
import { PickForm } from "./pick-form";

export const metadata = { title: "Choose a Page" };

export default async function PickPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const expired = `/brands/${slug}/connections?meta_error=${encodeURIComponent("Session expired, connect again")}`;
  const raw = (await cookies()).get("meta_pages")?.value;
  if (!raw) redirect(expired);
  let payload: { brandId: string; userToken: string };
  try {
    payload = decryptJson(raw);
  } catch {
    redirect(expired);
  }
  if (payload.brandId !== brand.id) redirect(expired);
  let pages: Awaited<ReturnType<typeof listPages>>;
  try {
    pages = await listPages(payload.userToken);
  } catch (e) {
    redirect(`/brands/${slug}/connections?meta_error=${encodeURIComponent(e instanceof Error ? e.message : "Could not list Pages")}`);
  }
  pages.sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Choose a Page for {brand.name}</h1>
      <PickForm slug={slug} pages={pages.map((p) => ({ id: p.id, name: p.name, ig_username: p.ig_username ?? null }))} />
    </div>
  );
}
