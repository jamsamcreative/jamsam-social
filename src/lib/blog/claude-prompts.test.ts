import { describe, it, expect } from "vitest";
import { suggestIdeasPrompt, writePostPrompt } from "./claude-prompts";

describe("claude prompts", () => {
  it("suggest ideas names the brand, the tools, and forbids drafting", () => {
    const p = suggestIdeasPrompt("acme", "Acme Buildings");
    expect(p).toContain("5 blog post ideas for Acme Buildings");
    expect(p).toContain('list_keyword_opportunities(brand: "acme"');
    expect(p).toContain('check_cannibalization(brand: "acme"');
    expect(p).toMatch(/Do not write any drafts yet/);
  });
  it("write post splices the keyword in, or tells Claude to pick one", () => {
    const withKw = writePostPrompt("acme", "Acme", " pole barn kits ");
    expect(withKw).toContain('targeting the keyword "pole barn kits"');
    expect(withKw).toContain('check_cannibalization(brand: "acme", keyword: "pole barn kits")');
    expect(withKw).toContain("create_article(");
    expect(withKw).toMatch(/do not push it to WordPress/);
    const noKw = writePostPrompt("acme", "Acme");
    expect(noKw).toContain("choose the highest-scoring NEW opportunity");
    expect(noKw).toContain('keyword: "<keyword>"');
  });
});
