import type { Tool } from "./types";
import { LOOKUP_TOOLS } from "./lookup";
import { WRITE_TOOLS } from "./write";
import { QUEUE_TOOLS } from "./queue";
import { SEO_TOOLS } from "./seo";

export const allTools: Tool[] = [...LOOKUP_TOOLS, ...SEO_TOOLS, ...WRITE_TOOLS, ...QUEUE_TOOLS];
/** The in-app agent owns its job, so it never sees the queue tools. */
export const agentTools: Tool[] = [...LOOKUP_TOOLS, ...SEO_TOOLS, ...WRITE_TOOLS];
export function findTool(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}
