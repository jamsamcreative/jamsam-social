export const AI_MODELS = ["claude-opus-5", "claude-sonnet-5"] as const;
export const DEFAULT_MODEL: (typeof AI_MODELS)[number] = "claude-opus-5";

export const RUNNERS = ["mcp", "in_app"] as const;
export type RunnerSetting = (typeof RUNNERS)[number];
/** MCP by default: jobs are written by the user's own Claude session (no API spend). */
export const DEFAULT_RUNNER: RunnerSetting = "mcp";
export const RUNNER_LABELS: Record<RunnerSetting, string> = {
  mcp: "MCP — your Claude account (free)",
  in_app: "In-app — Anthropic API (pay per job)",
};
