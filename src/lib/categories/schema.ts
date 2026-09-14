import { z } from "zod";
import { slugify } from "@/lib/brands/schema";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  target_percent: z.coerce.number().min(0).max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  sort_order: z.coerce.number().int().min(0).default(0),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export function toRow(i: CategoryInput) {
  return { name: i.name, slug: slugify(i.name), target_share: i.target_percent / 100, description: i.description || null, sort_order: i.sort_order };
}

/** Sum of targets (0–1) must stay ≤ 1 after applying a change. Returns an error string or null. */
export function checkTotal(existing: { id: string; target_share: number }[], next: { id?: string; target_share: number }): string | null {
  const total = existing.filter((c) => c.id !== next.id).reduce((s, c) => s + Number(c.target_share), 0) + next.target_share;
  return total > 1.0001 ? `Targets add up to ${Math.round(total * 100)}%; they must total 100% or less` : null;
}
