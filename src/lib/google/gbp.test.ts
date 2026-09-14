import { describe, it, expect } from "vitest";
import { buildGbpPost } from "@/lib/google/gbp";

describe("buildGbpPost", () => {
  it("strips URLs from the summary, caps at 1500, adds photo and CTA", () => {
    const p = buildGbpPost({ caption: "New shop done! Read more https://x.com/a\n\n\n#shop", link_url: "https://x.com/a", media: [{ url: "https://cdn/1.jpg" }, { url: "https://cdn/2.jpg" }] });
    expect(p.summary).toBe("New shop done! Read more \n\n#shop");
    expect(p.media).toEqual([{ mediaFormat: "PHOTO", sourceUrl: "https://cdn/1.jpg" }]);
    expect(p.callToAction).toEqual({ actionType: "LEARN_MORE", url: "https://x.com/a" });
    expect(buildGbpPost({ caption: "x".repeat(2000), link_url: null, media: [] }).summary).toHaveLength(1500);
    expect(buildGbpPost({ caption: "hi", link_url: null, media: [] })).toEqual({ languageCode: "en-US", summary: "hi", topicType: "STANDARD" });
  });
});
