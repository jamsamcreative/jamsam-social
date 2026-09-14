import { describe, it, expect } from "vitest";
import { checkCannibalization } from "@/lib/seo/cannibalization";

const art = (o: Partial<Parameters<typeof checkCannibalization>[0]["articles"][number]>) => ({ id: "a1", title: "Horse Barns Guide", slug: "horse-barns-guide", status: "published", primary_keyword: null, secondary_keywords: [], wp_link: null, ...o });
const page = (o: Partial<Parameters<typeof checkCannibalization>[0]["sitePages"][number]>) => ({ slug: "barns", url: "https://x.com/barns/", title: "We Build: Horse Barns & Arenas", type: "page", focus_keyword: null, ...o });

describe("checkCannibalization", () => {
  it("is clear when nothing matches", () => {
    const r = checkCannibalization({ keyword: "Barn House Kit Homes", slug: "barn-house-kit-homes", articles: [art({})], sitePages: [page({})], pagesMirrored: 1, opportunityKeywords: ["barn house kit homes"] });
    expect(r.has_conflict).toBe(false);
    expect(r.verdict).toMatch(/^CLEAR/);
    expect(r.already_listed_as_opportunity).toBe(true);
  });
  it("flags a live page using the slug first", () => {
    const r = checkCannibalization({ keyword: "horse barns", slug: "horse-barns", articles: [], sitePages: [page({ slug: "horse-barns", url: "https://x.com/horse-barns/", title: "Horse Barns: Sizes" })], pagesMirrored: 2 });
    expect(r.has_conflict).toBe(true);
    expect(r.verdict).toMatch(/slug "horse-barns" is already live/);
    expect(r.conflicts.live_page_using_this_slug?.url).toBe("https://x.com/horse-barns/");
  });
  it("flags an article with the same primary keyword", () => {
    const r = checkCannibalization({ keyword: "horse barns", articles: [art({ primary_keyword: "Horse Barns" })], sitePages: [] });
    expect(r.has_conflict).toBe(true);
    expect(r.conflicts.articles_with_same_primary_keyword).toHaveLength(1);
    expect(r.verdict).toMatch(/Optimize or rewrite/);
  });
  it("flags a live page whose title contains all keyword tokens, and lists partial mentions", () => {
    const r = checkCannibalization({ keyword: "horse barns", articles: [], sitePages: [page({}), page({ slug: "arenas", url: "https://x.com/arenas/", title: "Riding Arenas and Barns" })], pagesMirrored: 2 });
    expect(r.conflicts.live_page_on_this_topic?.slug).toBe("barns");
    expect(r.live_site_check.live_titles_mentioning_it.map((p) => p.slug)).toEqual([]);
  });
  it("flags a page already ranking in Search Console and notes secondary targets", () => {
    const r = checkCannibalization({ keyword: "pole barn garages", articles: [art({ secondary_keywords: ["pole barn garages"] })], sitePages: [], gscPages: [{ page: "https://x.com/garages/", position: 6.2, clicks: 40 }] });
    expect(r.has_conflict).toBe(true);
    expect(r.verdict).toMatch(/already ranks #6/);
    expect(r.articles_targeting_it_as_secondary).toHaveLength(1);
  });
  it("says when the site has not been mirrored", () => {
    expect(checkCannibalization({ keyword: "x", articles: [], sitePages: [] }).live_site_check.note).toMatch(/not been mirrored/);
  });
});
