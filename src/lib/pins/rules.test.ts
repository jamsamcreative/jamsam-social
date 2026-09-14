import { describe, it, expect } from "vitest";
import { validatePin, buildPinPayload, boardStats } from "@/lib/pins/rules";

const ok = { board_id: "b1", title: "40x60 Post Frame Shop in Spokane, WA", description: "A 40x60 post frame shop with two overhead doors, a 14 foot sidewall and a wainscot in dark bronze. Built for a family in Spokane who needed room for a truck, a boat and a workbench.", link: "https://jamsamdigital.com/projects/shop/", alt_text: "Brown post frame shop with two garage doors", image_url: "https://cdn/x.jpg" };

describe("validatePin", () => {
  it("passes a spec-compliant pin", () => {
    expect(validatePin(ok, "jamsamdigital.com")).toEqual({ errors: [], warnings: [] });
  });
  it("rejects emoji, hashtags, over-length, bad links; warns on short description and off-site link", () => {
    const r = validatePin({ ...ok, title: "Shop 🔥 #shop", description: "short", link: "http://other.com/x" }, "jamsamdigital.com");
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringMatching(/emoji/), expect.stringMatching(/hashtags/), expect.stringMatching(/https:/)]));
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/100–300/)]));
    expect(validatePin({ ...ok, link: "https://other.com/x" }, "jamsamdigital.com").warnings[0]).toMatch(/other.com/);
    expect(validatePin({ ...ok, title: "x".repeat(101) }).errors[0]).toMatch(/100/);
    expect(validatePin({ ...ok, link: null }).warnings[0]).toMatch(/No link/);
  });
  it("builds the Pinterest payload", () => {
    expect(buildPinPayload(ok)).toEqual({ board_id: "b1", title: ok.title, description: ok.description, link: ok.link, alt_text: ok.alt_text, media_source: { source_type: "image_url", url: "https://cdn/x.jpg" } });
  });
  it("boardStats medians over measured published pins only", () => {
    const s = boardStats([
      { board_id: "b1", status: "published", insights: { impressions: 10 } }, { board_id: "b1", status: "published", insights: { impressions: 30 } },
      { board_id: "b1", status: "published", insights: null }, { board_id: "b1", status: "draft", insights: null }, { board_id: "b2", status: "published", insights: { impressions: 5 } },
    ]);
    expect(s.b1).toEqual({ pins: 4, measured: 2, median_impressions: 20 });
    expect(s.b2).toEqual({ pins: 1, measured: 1, median_impressions: 5 });
  });
});
