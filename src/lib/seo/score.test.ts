import { describe, it, expect } from "vitest";
import { normaliseKeyword, tokens, intentWeight, opportunityAction, opportunityScore, rankOpportunities } from "@/lib/seo/score";

describe("score", () => {
  it("normalises and tokenises", () => {
    expect(normaliseKeyword("  Metal   Roofing SPOKANE ")).toBe("metal roofing spokane");
    expect(tokens("40x60 shop cost, WA")).toEqual(["40x60", "shop", "cost"]);
  });
  it("intent weights take the strongest listed intent", () => {
    expect(intentWeight("Informational, Transactional")).toBe(2);
    expect(intentWeight(null)).toBe(0.5);
  });
  it("action is OPTIMIZE when we already have a page, else NEW", () => {
    expect(opportunityAction({ keyword: "x", our_page: "/x/", our_position: 6.4 })).toBe("OPTIMIZE (ranks #6)");
    expect(opportunityAction({ keyword: "x" }, true)).toBe("OPTIMIZE (page exists, not ranking)");
    expect(opportunityAction({ keyword: "x" })).toBe("NEW");
  });
  it("scores reward volume, ease, intent and striking distance, capped at 10", () => {
    const easy = opportunityScore({ keyword: "a", volume: 3600, difficulty: 8, intent: "Commercial" });
    const hard = opportunityScore({ keyword: "b", volume: 3600, difficulty: 80, intent: "Commercial" });
    expect(easy).toBeGreaterThan(hard);
    expect(opportunityScore({ keyword: "c", volume: 100000, difficulty: 0, intent: "Transactional", our_position: 8, competitor_position: 3 })).toBe(10);
    expect(opportunityScore({ keyword: "d" })).toBeGreaterThan(0);
  });
  it("rankOpportunities filters and sorts", () => {
    const ks = [
      { keyword: "horse barns", cluster: "Agricultural", volume: 3600, difficulty: 39, intent: "Commercial", our_page: "/horse-barns/", our_position: 17 },
      { keyword: "barn house kit homes", cluster: "Barndominiums", volume: 590, difficulty: 8, intent: "Commercial" },
      { keyword: "pole barns garages", cluster: "Pole Barn Garage", volume: 170, difficulty: 24, intent: "Transactional" },
    ];
    const all = rankOpportunities(ks, new Set());
    expect(all[0].keyword).toBe("horse barns");
    expect(all[0].action).toBe("OPTIMIZE (ranks #17)");
    expect(rankOpportunities(ks, new Set(), { action: "NEW" }).map((k) => k.keyword)).toEqual(["barn house kit homes", "pole barns garages"]);
    expect(rankOpportunities(ks, new Set(), { cluster: "Barndominiums" })).toHaveLength(1);
    expect(rankOpportunities(ks, new Set(), { maxDifficulty: 10 })).toHaveLength(1);
    expect(rankOpportunities(ks, new Set(["pole barns garages"]))[2].action).toMatch(/OPTIMIZE/);
  });
});
