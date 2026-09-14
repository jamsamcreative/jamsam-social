import { describe, it, expect } from "vitest";
import { suggestInternalLinks } from "@/lib/seo/links";
import { dataFreshness } from "@/lib/seo/freshness";

const p = (slug: string, title: string, fk: string | null = null) => ({ slug, url: `https://x.com/${slug}/`, title, type: "post", focus_keyword: fk });

describe("internal links + freshness", () => {
  it("suggests pages with two or more shared tokens, strongest first", () => {
    const pages = [p("a", "Metal Roofing Costs in Spokane"), p("b", "Pole Barn Kits"), p("c", "Choosing Metal Roofing Colors", "metal roofing colors"), p("d", "About Us")];
    const r = suggestInternalLinks("metal roofing spokane", "How Much Does Metal Roofing Cost in Spokane?", pages);
    expect(r.map((x) => x.slug)).toEqual(["a", "c"]);
    expect(r[0].overlap).toBeGreaterThan(r[1].overlap);
  });
  it("freshness flags demand data older than 30 days", () => {
    const now = new Date("2026-09-14T00:00:00Z");
    expect(dataFreshness([], now)).toMatchObject({ stale: false, last_refreshed: null });
    expect(dataFreshness([{ kind: "keywords_csv", created_at: "2026-09-09T00:00:00Z", rows: 10 }, { kind: "site_mirror", created_at: "2026-09-13T00:00:00Z", rows: 5 }], now)).toMatchObject({ days_old: 5, stale: false });
    expect(dataFreshness([{ kind: "semrush_refresh", created_at: "2026-07-01T00:00:00Z", rows: 10 }], now)).toMatchObject({ stale: true });
  });
});
