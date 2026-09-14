import { describe, it, expect } from "vitest";
import { articleUrl } from "@/lib/ai/store";

describe("articleUrl", () => {
  it("prefers wp_link", () => {
    expect(articleUrl({ wp_link: "https://x.com/a/", slug: "a" }, { website_url: "https://x.com" })).toBe("https://x.com/a/");
  });
  it("falls back to website/slug/ and tolerates a trailing slash", () => {
    expect(articleUrl({ wp_link: null, slug: "a" }, { website_url: "https://x.com/" })).toBe("https://x.com/a/");
    expect(articleUrl({ wp_link: null, slug: "a" }, { website_url: null })).toBe("/a/");
  });
});
