import { describe, it, expect } from "vitest";
import { articleFormSchema } from "@/lib/articles/schema";

const base = {
  brand_id: "8b5d9c2e-7f1a-4c3b-9d2e-1a2b3c4d5e6f",
  title: "Hello",
  slug: "hello",
  content_html: "<p>x</p>",
  excerpt: "",
  seo_title: "",
  meta_description: "",
  primary_keyword: "",
  secondary_keywords: "a, b ,,A",
  featured_media: null,
  categories: [{ id: 1, name: "News" }],
  tags: [],
  decision: "new",
  rationale: "",
};

describe("articleFormSchema", () => {
  it("normalises blanks to null and splits keywords", () => {
    const r = articleFormSchema.parse(base);
    expect(r.excerpt).toBeNull();
    expect(r.seo_title).toBeNull();
    expect(r.secondary_keywords).toEqual(["a", "b"]);
  });
  it("rejects a bad slug", () => {
    expect(() => articleFormSchema.parse({ ...base, slug: "Bad Slug" })).toThrow();
  });
  it("caps secondary keywords at 20", () => {
    expect(() => articleFormSchema.parse({ ...base, secondary_keywords: Array.from({ length: 21 }, (_, i) => `k${i}`).join(",") })).toThrow();
  });
});
