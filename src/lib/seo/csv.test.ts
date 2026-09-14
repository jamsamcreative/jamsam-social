import { describe, it, expect } from "vitest";
import { parseCsv, parseKeywordCsv, parseProjectsCsv } from "@/lib/seo/csv";

describe("csv", () => {
  it("parses quotes, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("generic keyword CSV with aliases and a cluster column", () => {
    const r = parseKeywordCsv("Keyword,Search Volume,KD %,Intent,Competitor,Position,Topic\n Horse Barns ,3600,39,Commercial,https://www.dcbuilding.com/x,17,Agricultural\n,1,2,,,\nhorse barns,100,10,,,,\n");
    expect(r.layout).toBe("generic");
    expect(r.rows).toEqual([{ keyword: "horse barns", cluster: "Agricultural", volume: 100, difficulty: 10, intent: undefined, competitor: undefined, competitor_position: undefined, our_position: undefined }].map((x) => expect.objectContaining({ keyword: "horse barns", volume: 100 })));
    expect(r.skipped).toBe(2); // blank keyword + duplicate
  });
  it("SEMrush Keyword Gap layout picks the best non-brand domain", () => {
    const r = parseKeywordCsv("Keyword,Search Volume,Keyword Difficulty,Intent,steelstructuresamerica.com,dcbuilding.com,mqsbarn.com\nbarn house kit homes,590,8,Commercial,0,21,45\npole barns garages,170,24,Transactional,6,63,30\n", { brandDomain: "www.steelstructuresamerica.com" });
    expect(r.layout).toBe("keyword_gap");
    expect(r.rows[0]).toMatchObject({ keyword: "barn house kit homes", competitor: "dcbuilding.com", competitor_position: 21 });
    expect(r.rows[0].our_position).toBeUndefined();
    expect(r.rows[1]).toMatchObject({ our_position: 6, competitor: "mqsbarn.com", competitor_position: 30 });
  });
  it("errors without a keyword column", () => {
    expect(() => parseKeywordCsv("foo,bar\n1,2")).toThrow(/keyword column/);
  });
  it("projects CSV with images and tags", () => {
    const r = parseProjectsCsv("Title,URL,Category,City,State,Size,Description,Photos,Tags\n36x30 Shop,https://x/p/1,Shop,Ellensburg,wa,36x30,Nice,https://i/1.jpg|https://i/2.jpg,shop;wa\n,https://x/p/2,,,,,,,\n");
    expect(r.rows[0]).toMatchObject({ title: "36x30 Shop", state: "WA", dims: "36x30", images: [{ url: "https://i/1.jpg" }, { url: "https://i/2.jpg" }], tags: ["shop", "wa"] });
    expect(r.skipped).toBe(1);
  });
});
