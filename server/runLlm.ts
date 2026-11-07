import { runClaude } from "./claude";
import { runCodex } from "./codex";
import { chosenLlm } from "./llm";
import type { Llm, LlmResult, LlmRun } from "./llm";

const RUNNERS: Record<Llm, (run: LlmRun) => Promise<LlmResult>> = { claude: runClaude, openai: runCodex };

export const runLlm = (run: LlmRun) => RUNNERS[chosenLlm()](run);
