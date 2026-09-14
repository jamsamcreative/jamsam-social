import { describe, it, expect } from "vitest";
import { postFormSchema } from "@/lib/posts/schema";

const base = {
  brand_id: "8b5d9c2e-7f1a-4c3b-9d2e-1a2b3c4d5e6f",
  title: "T",
  link_url: "",
  media: [],
  targets: [
    { platform: "facebook", enabled: true, caption: "c", scheduled_local: "2026-09-14T15:00" },
    { platform: "instagram", enabled: false, caption: "", scheduled_local: null },
  ],
};

describe("postFormSchema", () => {
  it("normalises empty link to null and keeps targets", () => {
    const r = postFormSchema.parse(base);
    expect(r.link_url).toBeNull();
    expect(r.targets[0].scheduled_local).toBe("2026-09-14T15:00");
    expect(r.targets[1].scheduled_local).toBeNull();
  });
  it("rejects more than 10 media", () => {
    expect(() => postFormSchema.parse({ ...base, media: new Array(11).fill({ url: "https://x/1.jpg" }) })).toThrow();
  });
  it("rejects non-http media urls", () => {
    expect(() => postFormSchema.parse({ ...base, media: [{ url: "ftp://x/a" }] })).toThrow();
  });
});

describe("postFormSchema category", () => {
  const base = {
    brand_id: "3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e", title: "t", link_url: "", media: [],
    targets: [{ platform: "facebook", enabled: true, caption: "", scheduled_local: "" }, { platform: "instagram", enabled: false, caption: "", scheduled_local: "" }],
  };
  it("accepts an optional category_id", () => {
    expect(postFormSchema.parse(base).category_id).toBeNull();
    expect(postFormSchema.parse({ ...base, category_id: "3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e" }).category_id).toBe("3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e");
  });
});
