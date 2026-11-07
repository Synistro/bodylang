import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { LlmResult, LlmRun } from "./llm";

// A session started from inside Claude Code inherits variables that point its child at that session.
// Anything the bridge runs should be a plain Claude Code of its own. It finds its own credentials the way Claude Code
// always does: an ANTHROPIC_API_KEY if one is set, and otherwise the subscription this machine is logged in with.
export function claudeEnvironment(from: NodeJS.ProcessEnv = process.env) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(from)) {
    if (v === undefined || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "ANTHROPIC_BASE_URL") continue;
    env[k] = v;
  }
  return env;
}

// Every session here runs alone: no saved history, none of this machine's settings, and only the tools it is given.
// A subscription login also brings every connector on that account, whose tool definitions go along with each request,
// and without strictMcpConfig one Tell measured $2.98 of usage against $0.03.
export const claudeDefaults = () => ({
  tools: [],
  settingSources: [],
  strictMcpConfig: true,
  persistSession: false,
  permissionMode: "dontAsk" as const,
  env: claudeEnvironment(),
});

export async function runClaude(run: LlmRun): Promise<LlmResult> {
  const session = query({
    prompt: run.prompt,
    options: {
      ...claudeDefaults(),
      model: run.model,
      effort: run.effort,
      maxTurns: run.maxTurns,
      systemPrompt: run.system,
      abortController: run.abort,
      includePartialMessages: run.onText !== undefined,
      ...(run.tools?.length
        ? {
            allowedTools: ["mcp__body__*"],
            mcpServers: {
              body: createSdkMcpServer({
                name: "body",
                version: "0.0.0",
                tools: run.tools as SdkMcpToolDefinition<any>[],
              }),
            },
          }
        : {}),
    },
  });
  const result: LlmResult = { subtype: "success", text: "", turns: 0, costUsd: 0, usage: "" };
  let spoke = false;
  for await (const message of session) {
    if (message.type === "assistant" && !spoke) {
      spoke = true;
      run.onOutput?.();
    }
    if (
      message.type === "stream_event" &&
      message.event.type === "content_block_delta" &&
      message.event.delta.type === "text_delta"
    )
      run.onText?.(message.event.delta.text);
    if (message.type === "result") {
      result.subtype = message.subtype;
      result.turns = message.num_turns;
      result.costUsd = message.total_cost_usd;
      result.usage = `$${message.total_cost_usd.toFixed(4)}`;
      if (message.subtype === "success") result.text = message.result;
    }
  }
  return result;
}
