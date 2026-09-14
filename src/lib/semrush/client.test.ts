import { describe, it, expect } from "vitest";
import { phraseThese, domainDomains, estimateUnits } from "@/lib/semrush/client";

const mock = (body: string, capture?: (u: URL) => void): typeof fetch => (async (input) => { capture?.(new URL(String(input))); return new Response(body); }) as typeof fetch;

describe("semrush client", () => {
  it("phrase_these parses semicolon output and intent codes", async () => {
    let url: URL | null = null;
    const f = mock("Keyword;Search Volume;Keyword Difficulty Index;Intent\nhorse barns;3600;39;0\nbarn kits;590;8;0,3\n", (u) => (url = u));
    const r = await phraseThese("k", "us", ["Horse Barns", "barn kits"], f);
    expect(r).toEqual([{ keyword: "horse barns", volume: 3600, difficulty: 39, intent: "Commercial" }, { keyword: "barn kits", volume: 590, difficulty: 8, intent: "Commercial, Transactional" }]);
    expect(url!.searchParams.get("type")).toBe("phrase_these");
    expect(url!.searchParams.get("phrase")).toBe("Horse Barns;barn kits");
  });
  it("domain_domains picks the best competitor and our position", async () => {
    const f = mock("Keyword;Search Volume;Keyword Difficulty Index;Intent;ssa.com;dc.com;mqs.com\npole barns garages;170;24;3;6;63;30\nnew thing;100;10;1;0;12;0\n");
    const r = await domainDomains("k", "us", "ssa.com", ["dc.com", "mqs.com"], 500, f);
    expect(r[0]).toMatchObject({ keyword: "pole barns garages", our_position: 6, competitor: "mqs.com", competitor_position: 30 });
    expect(r[1]).toMatchObject({ keyword: "new thing", our_position: undefined, competitor: "dc.com", competitor_position: 12 });
  });
  it("surfaces SEMrush errors and estimates units", async () => {
    await expect(phraseThese("k", "us", ["x"], mock("ERROR 120 :: WRONG KEY - ID PAIR"))).rejects.toThrow(/WRONG KEY/);
    expect(estimateUnits({ keywords: 50, gapRows: 500 })).toBe(5500);
  });
});
