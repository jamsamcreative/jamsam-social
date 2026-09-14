import { z } from "zod";
import { defineTool, requireBrand, ToolError } from "./types";
import { validatePin } from "@/lib/pins/rules";

const brand = z.string().describe("Brand slug");

export const listPinBoards = defineTool({
  name: "list_pin_boards",
  description: "A brand's Pinterest boards with how many pins each already holds in this app and how measured pins performed (median impressions). Call before create_pin: board_id is required and a pin on the wrong board is a pin nobody browsing that board will find. Board differences are small relative to the spread — pick the board that is correct, not the one with the best number.",
  input: z.object({ brand }),
  run: async (ctx, { brand: slug }) => {
    const b = await requireBrand(ctx, slug);
    const boards = await ctx.store.listPinBoards(b.id);
    if (boards.length === 0) throw new ToolError("No boards synced for this brand. Connect Pinterest and sync boards under Connections.");
    return { boards, note: "median_impressions is over MEASURED published pins only; Pinterest returns no metrics for very new or very old pins." };
  },
});

export const createPinTool = defineTool({
  name: "create_pin",
  description: "Create a Pinterest pin. It lands as a DRAFT — a human approves and schedules it before anything publishes. Pinterest is a search engine, not a feed: follow pin_spec. Rules enforced here: title ≤ 100 chars leading with dimensions when known, description 100–300 chars of searchable text, no emoji, no hashtags, link to our own site, never invent a dimension or colour.",
  input: z.object({
    brand,
    board_id: z.string().min(1).describe("From list_pin_boards"),
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    image_url: z.string().url().optional().describe("Public image URL (project photo or media asset url). Pinterest fetches it at publish time."),
    media_asset_id: z.string().uuid().optional().describe("Instead of image_url: the media asset the human picked (pin jobs carry it in the brief)"),
    project_id: z.string().uuid().optional().describe("The content-bank project this pin is about, when it came from search_projects"),
    link: z.string().url().optional().describe("Destination on our own site. Never a shortener."),
    alt_text: z.string().max(500).optional().describe("Literal description of the photo for screen readers"),
  }),
  run: async (ctx, i) => {
    const b = await requireBrand(ctx, i.brand);
    let image_url = i.image_url ?? null;
    if (!image_url && i.media_asset_id) image_url = (await ctx.store.getMediaAsset(i.media_asset_id))?.url ?? null;
    if (!image_url && i.project_id) image_url = ((await ctx.store.getProject(i.project_id))?.images as { url: string }[] | null)?.[0]?.url ?? null;
    if (!image_url) throw new ToolError("No image: pass image_url, or a media_asset_id / project_id that has an image.");
    const boards = await ctx.store.listPinBoards(b.id);
    const board = boards.find((x) => x.board_id === i.board_id);
    if (!board) throw new ToolError(`Unknown board_id "${i.board_id}". Valid: ${boards.map((x) => `${x.board_id} (${x.name})`).join(", ") || "(none synced)"}`);
    let host: string | null = null;
    try {
      host = b.website_url ? new URL(b.website_url).hostname : null;
    } catch {}
    const pin = { board_id: i.board_id, title: i.title, description: i.description, link: i.link ?? null, alt_text: i.alt_text ?? null, image_url };
    const check = validatePin(pin, host);
    if (check.errors.length) throw new ToolError(`Pin rules violated — fix and call again:\n- ${check.errors.join("\n- ")}`);
    const { pin_id } = await ctx.store.createPin({ brand_id: b.id, board_name: board.name, ...pin, media_asset_id: i.media_asset_id ?? null, project_id: i.project_id ?? null, source: "ai", created_by: ctx.actor.userId ?? null });
    return { pin_id, warnings: check.warnings };
  },
});

export const listUnpinned = defineTool({
  name: "list_unpinned",
  description: "Media assets or content-bank projects that have no pin yet — the way to avoid pinning the same photo or building twice.",
  input: z.object({ brand, kind: z.enum(["media", "projects"]).default("projects"), limit: z.number().int().min(1).max(100).default(20) }),
  run: async (ctx, { brand: slug, kind, limit }) => ctx.store.listUnpinned((await requireBrand(ctx, slug)).id, kind, limit),
});

export const PIN_TOOLS = [listPinBoards, createPinTool, listUnpinned];
