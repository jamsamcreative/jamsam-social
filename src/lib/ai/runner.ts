import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { createSupabaseStore, type Store } from "./store";
import { agentTools } from "./tools/registry";
import { ToolError, type Tool } from "./tools/types";
import { buildBrief } from "./brief";
import { buildSystemPrompt } from "./prompts/system";
import { TERMINAL_TOOL, parseJobResult } from "./schemas";
import type { Json } from "@/lib/database.types";

export const DEFAULT_MODEL = "claude-opus-5";
export type RunnerDeps = {
  store: Store;
  client: Pick<Anthropic, "messages">;
  model: string;
  maxTurns?: number;
  maxInputTokens?: number;
  sleep?: (ms: number) => Promise<void>;
};

function toAnthropicTool(t: Tool): Anthropic.Tool {
  const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema };
}

function isTransient(e: unknown): boolean {
  const s = (e as { status?: number }).status;
  return s === 429 || s === 408 || s === 409 || (typeof s === "number" && s >= 500);
}

async function createWithRetry(deps: RunnerDeps, params: Anthropic.MessageStreamParams): Promise<Anthropic.Message> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await deps.client.messages.stream(params).finalMessage();
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw last;
}

/** Runs one queued in-app job to completion. Pure over deps so tests can script the model. */
export async function runJobWith(jobId: string, deps: RunnerDeps): Promise<"completed" | "failed" | "skipped"> {
  const { store } = deps;
  const maxTurns = deps.maxTurns ?? 20;
  const maxInput = deps.maxInputTokens ?? 150_000;
  const startedAt = new Date().toISOString();
  const current = await store.getJob(jobId);
  if (!current) return "skipped";
  const running = await store.transitionJob(jobId, ["queued"], {
    status: "running", started_at: startedAt, attempts: current.attempts + 1, claimed_by: "in_app", claimed_at: startedAt, error: null,
  });
  if (!running) return "skipped";

  const fail = async (error: string) => {
    await store.updateJob(jobId, { status: "failed", error: error.slice(0, 2000), finished_at: new Date().toISOString(), model: deps.model });
    return "failed" as const;
  };

  try {
    const brief = await buildBrief(store, running);
    const terminal = TERMINAL_TOOL[running.type];
    const tools = agentTools.map(toAnthropicTool);
    const ctx = { store, actor: { kind: "in_app" as const, userId: running.created_by ?? undefined } };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Job brief (JSON):\n${JSON.stringify(brief, null, 2)}` }];
    const system = buildSystemPrompt(brief);
    let inputTokens = 0;
    let outputTokens = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await createWithRetry(deps, { model: deps.model, max_tokens: 16000, system, tools, messages });
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;
      await store.updateJob(jobId, { input_tokens: inputTokens, output_tokens: outputTokens, model: deps.model });
      if (inputTokens > maxInput) return fail(`Token budget exceeded (${inputTokens} input tokens > ${maxInput})`);
      if (res.stop_reason === "refusal") return fail("Model refused the request");
      messages.push({ role: "assistant", content: res.content });
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) return fail(`Model ended its turn without calling ${terminal}`);

      const results: Anthropic.ToolResultBlockParam[] = [];
      let done: unknown = null;
      for (const u of uses) {
        const tool = agentTools.find((t) => t.name === u.name);
        try {
          if (!tool) throw new ToolError(`Unknown tool ${u.name}`);
          const parsed = tool.input.safeParse(u.input);
          if (!parsed.success) throw new ToolError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
          const out = await tool.run(ctx, parsed.data);
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out ?? null) });
          if (u.name === terminal) done = out;
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          results.push({ type: "tool_result", tool_use_id: u.id, content: e.message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });

      if (done !== null) {
        // submit_captions writes onto the job row; the other terminal tools return the result directly.
        const result = running.type === "caption" ? (await store.getJob(jobId))?.result : done;
        const parsed = parseJobResult(running.type, result);
        if (!parsed.success) return fail(`Terminal tool returned an unexpected shape: ${parsed.error.issues[0]?.message}`);
        const r = parsed.data as Record<string, unknown>;
        await store.updateJob(jobId, {
          status: "completed", result: r as Json, finished_at: new Date().toISOString(), error: null,
          post_id: (r.post_id as string | undefined) ?? running.post_id, article_id: (r.article_id as string | undefined) ?? running.article_id,
        });
        return "completed";
      }
    }
    return fail(`Gave up after ${maxTurns} turns without a successful ${terminal} call`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Production entry point: real store + Anthropic client, model from app_settings. Never throws. */
export async function runJob(jobId: string): Promise<void> {
  const store = createSupabaseStore();
  const model = (await store.getSetting("ai_model")) ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    await runJobWith(jobId, { store, client, model });
  } catch (e) {
    await store
      .updateJob(jobId, { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 2000), finished_at: new Date().toISOString() })
      .catch(() => {});
  }
}
