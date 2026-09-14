import { describe, it, expect } from "vitest";
import { fakeStore, BRAND, job } from "@/lib/ai/fake-store";
import { listPinBoards, createPinTool, listUnpinned } from "@/lib/ai/tools/pins";
import { buildBrief } from "@/lib/ai/brief";

const ctx = (store = fakeStore()) => ({ store, actor: { kind: "in_app" as const } });
const boards = [{ board_id: "b1", name: "Shops", pin_count: 4, pins_in_app: 2, measured: 1, median_impressions: 120 }];
const project = { id: "55555555-5555-4555-8555-555555555555", brand_id: BRAND.id, external_id: "4521", title: "36x30 Shop Ellensburg", url: "https://acme.com/projects/1/", category: "Shop", location: "Ellensburg, WA", state: "WA", dims: "36x30", description: "Nice", images: [{ url: "https://cdn/p1.jpg" }], tags: [], imported_at: "2026-09-01T00:00:00Z" };
const good = { brand: "acme", board_id: "b1", title: "36x30 Shop in Ellensburg, WA", description: "A 36x30 post frame shop in Ellensburg, WA with a 12 foot sidewall, one overhead door and a covered lean-to for firewood and the tractor. Built on a gravel pad outside town.", link: "https://acme.com/projects/1/" };

describe("pin tools", () => {
  it("list_pin_boards returns stats or a clear error when none synced", async () => {
    expect(await listPinBoards.run(ctx(fakeStore({ boards })), { brand: "acme" })).toMatchObject({ boards });
    await expect(listPinBoards.run(ctx(), { brand: "acme" })).rejects.toThrow(/No boards synced/);
  });
  it("create_pin resolves the image from a project, validates rules, lands as an ai draft", async () => {
    const store = fakeStore({ boards, projects: [project] });
    const r = await createPinTool.run(ctx(store), { ...good, project_id: project.id });
    expect(r).toMatchObject({ pin_id: "77777777-7777-4777-8777-777777777777", warnings: [] });
    expect(store.created.pins[0]).toMatchObject({ board_name: "Shops", image_url: "https://cdn/p1.jpg", source: "ai", project_id: project.id });
    await expect(createPinTool.run(ctx(store), { ...good, image_url: "https://cdn/x.jpg", title: "Shop #deal 🔥" })).rejects.toThrow(/emoji|hashtags/);
    await expect(createPinTool.run(ctx(store), { ...good, image_url: "https://cdn/x.jpg", board_id: "nope" })).rejects.toThrow(/Unknown board_id/);
    await expect(createPinTool.run(ctx(store), { ...good })).rejects.toThrow(/No image/);
  });
  it("list_unpinned and the pin brief", async () => {
    const store = fakeStore({ boards, projects: [project], media: [{ id: "66666666-6666-4666-8666-666666666666", url: "https://cdn/m.jpg", alt: "deck", tags: ["deck"], used_as_featured: false }] });
    expect(await listUnpinned.run(ctx(store), { brand: "acme", kind: "projects", limit: 20 })).toEqual([{ id: project.id, title: project.title, url: project.url, image_url: "https://cdn/p1.jpg" }]);
    const b = await buildBrief(store, job({ type: "pin", input: { project_id: project.id } }));
    expect(b.project?.dims).toBe("36x30");
    expect(b.boards?.[0].name).toBe("Shops");
    expect(b.instructions).toMatch(/create_pin/);
    const b2 = await buildBrief(store, job({ type: "pin", input: { media_asset_id: "66666666-6666-4666-8666-666666666666" } }));
    expect(b2.asset?.url).toBe("https://cdn/m.jpg");
  });
});
