import { describe, it, expect } from "vitest";
import { brandInputSchema, slugify } from "@/lib/brands/schema";

describe("slugify", () => {
  it("lowercases, strips punctuation, hyphenates spaces", () => {
    expect(slugify("Acme Roofing & Siding, Inc.")).toBe("acme-roofing-siding-inc");
  });
  it("collapses repeated hyphens and trims", () => {
    expect(slugify("  --Big   Sky--  ")).toBe("big-sky");
  });
});

describe("brandInputSchema", () => {
  it("accepts a valid brand and normalises empty optional strings to null", () => {
    const r = brandInputSchema.parse({ name: "Acme", slug: "acme", website_url: "", timezone: "America/Denver", seo_suffix: "" });
    expect(r.website_url).toBeNull();
    expect(r.seo_suffix).toBeNull();
  });
  it("rejects a slug with uppercase or spaces", () => {
    expect(() => brandInputSchema.parse({ name: "A", slug: "Bad Slug", timezone: "UTC" })).toThrow();
  });
  it("rejects an invalid website URL", () => {
    expect(() => brandInputSchema.parse({ name: "A", slug: "a", website_url: "not a url", timezone: "UTC" })).toThrow();
  });
  it("rejects an unknown timezone", () => {
    expect(() => brandInputSchema.parse({ name: "A", slug: "a", timezone: "Mars/Olympus" })).toThrow(/timezone/i);
  });
});
