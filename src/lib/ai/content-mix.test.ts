import { describe, it, expect } from "vitest";
import { computeContentMix } from "@/lib/ai/content-mix";

const cats = [
  { id: "a", name: "Projects", slug: "projects", target_share: 0.5, description: null, sort_order: 0 },
  { id: "b", name: "Tips", slug: "tips", target_share: 0.3, description: null, sort_order: 1 },
  { id: "c", name: "Credibility", slug: "credibility", target_share: 0.2, description: null, sort_order: 2 },
];

describe("computeContentMix", () => {
  it("returns empty when the brand has no categories", () => {
    expect(computeContentMix([], [{ category_id: null }])).toEqual({ window: 20, total: 1, categories: [], favour_next: null });
  });
  it("computes actual shares over the window, counting uncategorized in the denominator", () => {
    const posts = [{ category_id: "a" }, { category_id: "a" }, { category_id: "b" }, { category_id: null }];
    const mix = computeContentMix(cats, posts);
    expect(mix.total).toBe(4);
    expect(mix.categories.find((c) => c.slug === "projects")).toMatchObject({ count: 2, actual_share: 0.5 });
    expect(mix.categories.find((c) => c.slug === "tips")).toMatchObject({ count: 1, actual_share: 0.25 });
    expect(mix.categories.find((c) => c.slug === "credibility")).toMatchObject({ count: 0, actual_share: 0 });
  });
  it("favours the most under-served category, ties broken by sort_order", () => {
    expect(computeContentMix(cats, [{ category_id: "a" }, { category_id: "a" }]).favour_next).toBe("tips");
    expect(computeContentMix(cats, []).favour_next).toBe("projects");
  });
  it("only considers the last 20 posts", () => {
    const posts = [...Array(20).fill({ category_id: "b" }), ...Array(10).fill({ category_id: "a" })];
    expect(computeContentMix(cats, posts).total).toBe(20);
    expect(computeContentMix(cats, posts).categories.find((c) => c.slug === "projects")?.count).toBe(0);
  });
});
