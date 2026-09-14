import type { Tool } from "./types";
import { LOOKUP_TOOLS } from "./lookup";

export const allTools: Tool[] = [...LOOKUP_TOOLS];
/** Tools the in-app agent gets (the runner owns the job, so queue tools are excluded). */
export const agentTools: Tool[] = [...LOOKUP_TOOLS];
export function findTool(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}
