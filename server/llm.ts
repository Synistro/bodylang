import type { ZodType } from "zod";

// Which company's LLM answers. Everything else, the tools, the prompts and the number check, is the same for both.
export const LLMS = ["claude", "openai"] as const;
export type Llm = (typeof LLMS)[number];

export function chosenLlm(from: NodeJS.ProcessEnv = process.env): Llm {
  const chosen = from.BODYLANG_LLM ?? "claude";
  if (!(LLMS as readonly string[]).includes(chosen))
    throw new Error(`BODYLANG_LLM is "${chosen}". Set it to ${LLMS.join(" or ")} and restart the server.`);
  return chosen as Llm;
}

export type ModelRole = "talk" | "deep" | "small";

const MODELS: Record<Llm, Record<ModelRole, string>> = {
  claude: { talk: "claude-sonnet-5-5", deep: "claude-opus-5-5", small: "claude-haiku-5-5" },
  openai: { talk: "gpt-6.1-terra", deep: "gpt-6.1-sol", small: "gpt-6-luna" },
};
const MODEL_SETTING: Record<ModelRole, string> = {
  talk: "BODYLANG_MODEL",
  deep: "BODYLANG_DEEP_MODEL",
  small: "BODYLANG_EXPLAIN_MODEL",
};

export const modelFor = (role: ModelRole, from: NodeJS.ProcessEnv = process.env) =>
  from[MODEL_SETTING[role]] ?? MODELS[chosenLlm(from)][role];

export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Record<string, ZodType>;
  handler: (args: any, extra: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>;
}

export interface LlmRun {
  system: string;
  prompt: string;
  model: string;
  effort: "low" | "medium" | "high";
  maxTurns: number;
  tools?: LlmTool[];
  abort: AbortController;
  onOutput?: () => void; // the LLM has started answering, which shows what starting up costs
  onText?: (text: string) => void; // words as they arrive, for an answer that is plain text
}

export interface LlmResult {
  subtype: string; // "success", or how it stopped
  text: string;
  turns: number;
  costUsd: number; // what the same run costs on an API key, where the LLM says so, and otherwise 0
  usage: string; // the same in words for the log
}

// What a person sees when a run fails. Being logged out is the one failure they can fix from here.
export function runFailure(reason: string, from: NodeJS.ProcessEnv = process.env) {
  if (/out of credits/i.test(reason) && chosenLlm(from) === "openai")
    return "This ChatGPT login is on a workspace with no credits. Run `pnpm login:openai` again and choose the workspace your plan is on.";
  if (/not logged in/i.test(reason))
    return chosenLlm(from) === "openai"
      ? "OpenAI isn't logged in for Bodylang. Run `pnpm login:openai` in a terminal, then send this again."
      : "Claude Code isn't logged in. Run `claude auth login` in a terminal, or set ANTHROPIC_API_KEY and restart the server, then send this again.";
  return `The LLM could not run: ${reason}`;
}

// A build spends about $0.80 and commits to this checkout, so a person turns builds on themselves. The build session
// runs on the Claude Agent SDK alone.
export const buildsAllowed = (from: NodeJS.ProcessEnv = process.env) =>
  from.BODYLANG_BUILDS === "1" && chosenLlm(from) === "claude";
