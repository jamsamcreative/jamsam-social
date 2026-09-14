export const MIX_WINDOW = 20;
export type CategoryLike = { id: string; name: string; slug: string; target_share: number; description: string | null; sort_order: number };
export type ContentMix = {
  window: number;
  total: number;
  categories: { id: string; name: string; slug: string; description: string | null; target_share: number; actual_share: number; count: number }[];
  favour_next: string | null;
};

/** posts must be ordered newest first; only the first MIX_WINDOW are considered. */
export function computeContentMix(categories: CategoryLike[], posts: { category_id: string | null }[]): ContentMix {
  const recent = posts.slice(0, MIX_WINDOW);
  const total = recent.length;
  if (categories.length === 0) return { window: MIX_WINDOW, total, categories: [], favour_next: null };
  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const rows = sorted.map((c) => {
    const count = recent.filter((p) => p.category_id === c.id).length;
    return { id: c.id, name: c.name, slug: c.slug, description: c.description, target_share: Number(c.target_share), actual_share: total ? count / total : 0, count };
  });
  let best = rows[0];
  for (const r of rows) if (r.target_share - r.actual_share > best.target_share - best.actual_share) best = r;
  return { window: MIX_WINDOW, total, categories: rows, favour_next: best.slug };
}
