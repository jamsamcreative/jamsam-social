import { z } from "zod";
import type { Store, StoreBrand } from "../store";

export type ToolActor = { kind: "in_app" | "mcp"; userId?: string; clientName?: string };
export type ToolCtx = { store: Store; actor: ToolActor };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tool<I = any> = { name: string; description: string; input: z.ZodObject<z.ZodRawShape>; run(ctx: ToolCtx, input: I): Promise<unknown> };

/** Errors the model/MCP client should see and can act on. Anything else is a bug and propagates. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(t: {
  name: string;
  description: string;
  input: S;
  run(ctx: ToolCtx, input: z.infer<S>): Promise<unknown>;
}): Tool<z.infer<S>> {
  return t;
}

export async function requireBrand(ctx: ToolCtx, slug: string): Promise<StoreBrand> {
  const b = await ctx.store.getBrandBySlug(slug);
  if (!b) throw new ToolError(`Unknown brand slug "${slug}". Call list_brands for valid slugs.`);
  return b;
}
