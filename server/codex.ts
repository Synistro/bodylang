import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { LlmResult, LlmRun, LlmTool } from "./llm";

// OpenAI's models run through Codex's app server, which reaches a ChatGPT plan through Codex's own login. OpenAI's docs
// allow this for a local or open-source app. Bodylang keeps its login in a Codex home of its own, so a person's Codex
// settings, MCP servers, hooks and instructions never reach these sessions, and it never reads the login itself.
export const CODEX_HOME = join(homedir(), ".bodylang", "codex");
// Codex's own launcher, run by Node, which finds the binary for this system.
const CODEX = join(process.cwd(), "node_modules", "@openai", "codex", "bin", "codex.js");
const MOST_TOOL_CALLS_PER_TURN = 4;
// Codex's models answer in their own words unless told otherwise, and the page shows only what tools send. Without
// this, an Ask came back as plain text with no walkthrough and no reply.
export const ONLY_TOOLS_REACH_THEM =
  "The person never sees text you write yourself. Everything they see comes from the tools, so do the whole job through them and finish with the calls the instructions ask for. Call each tool on its own, and if one refuses its input, fix what the error names and call it again before you go on.";

// Codex's models call every tool from JavaScript in a sandbox with no file system or network, so that one feature stays
// on. Turning off everything else removes the shell, web search, images and connectors. Listing Codex's own features
// means a new one starts off too.
export function lockdownArgs(featureList: string, catalogPath: string) {
  const features = featureList
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => /^[a-z0-9_]+$/.test(name) && name !== "code_mode_host");
  const settings = [
    ...features.map((name) => `features.${name}=false`),
    'web_search="disabled"',
    "project_doc_max_bytes=0",
    "skills.include_instructions=false",
    "skills.bundled.enabled=false",
    "analytics.enabled=false",
    `model_catalog_json=${JSON.stringify(catalogPath)}`,
  ];
  return settings.flatMap((setting) => ["-c", setting]);
}

// Two tools come from what each model says it supports, and no setting removes them: file edits and sub-agents.
export function withoutEditsOrSubAgents(catalog: { models: Record<string, unknown>[] }) {
  return {
    ...catalog,
    models: catalog.models.map((model) => {
      const { multi_agent_reasoning_effort: _, ...rest } = model;
      return { ...rest, multi_agent_version: null, apply_patch_tool_type: null };
    }),
  };
}

// Codex shows each tool to the model as a TypeScript declaration. A field with many alternative shapes, such as a
// walkthrough step's close-up, makes it give up and declare every optional field beside it as unknown. So those
// fields are declared as plain objects, and the full schema goes in the description, which reaches the model whole.
// Bodylang still checks every input against the real schema.
function withoutAlternatives(schema: unknown): { schema: unknown; changed: boolean } {
  if (Array.isArray(schema)) {
    const parts = schema.map(withoutAlternatives);
    return { schema: parts.map((part) => part.schema), changed: parts.some((part) => part.changed) };
  }
  if (!schema || typeof schema !== "object") return { schema, changed: false };
  const { oneOf, ...rest } = schema as Record<string, unknown>;
  if (oneOf) return { schema: { ...rest, type: "object" }, changed: true };
  let changed = false;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    const part = withoutAlternatives(value);
    copy[key] = part.schema;
    changed ||= part.changed;
  }
  return { schema: copy, changed };
}

export function toolSpec(tool: LlmTool) {
  const { $schema: _, ...full } = z.toJSONSchema(z.object(tool.inputSchema)) as Record<string, unknown>;
  const shown = withoutAlternatives(full);
  return {
    type: "function",
    name: tool.name,
    description: shown.changed
      ? `${tool.description}\n\nIts full input, as JSON Schema:\n${JSON.stringify(full)}`
      : tool.description,
    inputSchema: shown.schema,
  };
}

let lockdown: string[] | null = null;
function lockedDown(env: NodeJS.ProcessEnv) {
  if (lockdown) return lockdown;
  mkdirSync(CODEX_HOME, { recursive: true, mode: 0o700 });
  const ask = (...args: string[]) => execFileSync(process.execPath, [CODEX, ...args], { env, encoding: "utf8" });
  const catalogPath = join(CODEX_HOME, "bodylang-models.json");
  writeFileSync(catalogPath, JSON.stringify(withoutEditsOrSubAgents(JSON.parse(ask("debug", "models")))));
  lockdown = lockdownArgs(ask("features", "list"), catalogPath);
  return lockdown;
}

export interface AppServer {
  send: (message: object) => void;
  onMessage: (receive: (message: any) => void) => void;
  onExit: (exited: (reason: string) => void) => void;
  close: () => void;
}

function openAppServer(cwd: string): AppServer {
  const env = { ...process.env, CODEX_HOME };
  const child = spawn(process.execPath, [CODEX, "app-server", ...lockedDown(env)], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let lastWords = "";
  child.stderr.on("data", (data: Buffer) => {
    lastWords = String(data).trim().slice(-500);
  });
  return {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    onMessage: (receive) => {
      let waiting = "";
      child.stdout.on("data", (data: Buffer) => {
        waiting += data;
        const lines = waiting.split("\n");
        waiting = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) receive(JSON.parse(line));
      });
    },
    onExit: (exited) => {
      child.on("error", (e) => exited(`Codex could not start: ${e.message}. Run pnpm install.`));
      child.on("exit", (code) => exited(lastWords || `Codex stopped with code ${code}.`));
    },
    close: () => child.kill(),
  };
}

// One conversation with the app server: it sends back answers, notifications, and requests to run a tool.
export async function converse(server: AppServer, run: LlmRun, cwd: string): Promise<LlmResult> {
  const tools = new Map((run.tools ?? []).map((tool) => [tool.name, tool]));
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  const ask = (method: string, params: object) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      server.send({ method, id, params });
    });

  let text = "";
  let toolCalls = 0;
  let tokens = 0;
  let spoke = false;
  const speak = () => {
    if (!spoke) run.onOutput?.();
    spoke = true;
  };
  let threadId: string | null = null;
  let turnId: string | null = null;
  const interrupt = () => {
    if (threadId && turnId) server.send({ method: "turn/interrupt", id: nextId++, params: { threadId, turnId } });
  };
  run.abort.signal.addEventListener("abort", interrupt);

  // A model can ask for several tools at once, and each changes the state the next one reads, so they run in order.
  let toolsDone: Promise<unknown> = Promise.resolve();
  const runTool = async (id: number, name: string, input: unknown) => {
    const tool = tools.get(name);
    const parsed = tool && z.object(tool.inputSchema).safeParse(input);
    let reply: { contentItems: { type: string; text: string }[]; success: boolean };
    if (!tool || !parsed?.success) {
      const problem =
        tool && parsed?.error ? `Bad input:\n${z.prettifyError(parsed.error)}` : `There is no tool called ${name}.`;
      console.warn(
        `[bodylang] refused ${name}: ${problem.slice(0, 300)}. Input: ${JSON.stringify(input).slice(0, 300)}`,
      );
      reply = { contentItems: [{ type: "inputText", text: problem }], success: false };
    } else {
      const result = await tool.handler(parsed.data, {});
      const items = result.content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : []));
      reply = {
        contentItems: items.map((words) => ({ type: "inputText", text: words })),
        success: !result.isError,
      };
    }
    server.send({ id, result: reply });
  };

  const finished = new Promise<string>((resolve, reject) => {
    server.onExit((reason) => reject(new Error(reason)));
    server.onMessage((message) => {
      if (message.id !== undefined && message.method === undefined) {
        const answer = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error) answer?.reject(new Error(message.error.message));
        else answer?.resolve(message.result);
        return;
      }
      if (message.id !== undefined) {
        if (message.method !== "item/tool/call") {
          server.send({ id: message.id, error: { code: -32601, message: "Bodylang doesn't do that." } });
          return;
        }
        speak();
        toolCalls += 1;
        if (toolCalls > run.maxTurns * MOST_TOOL_CALLS_PER_TURN) {
          interrupt();
          resolve("error_max_turns");
          return;
        }
        const { tool, arguments: input } = message.params;
        toolsDone = toolsDone.then(() => runTool(message.id, tool, input));
        return;
      }
      if (message.method === "item/agentMessage/delta") {
        speak();
        text += message.params.delta;
        run.onText?.(message.params.delta);
      } else if (message.method === "thread/tokenUsage/updated") {
        tokens = message.params.tokenUsage.total.totalTokens;
      } else if (message.method === "turn/started") {
        turnId = message.params.turn.id;
      } else if (message.method === "turn/completed") {
        const { status, error } = message.params.turn;
        if (status === "failed") reject(new Error(error?.message ?? "The turn failed."));
        else resolve(status === "completed" ? "success" : status);
      }
    });
  });
  finished.catch(() => {});

  await Promise.race([
    (async () => {
      await ask("initialize", {
        clientInfo: { name: "bodylang", title: "Bodylang", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      server.send({ method: "initialized" });
      const { account } = await ask("account/read", {});
      if (!account) throw new Error("Not logged in.");
      const started = await ask("thread/start", {
        model: run.model,
        cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        baseInstructions: run.tools?.length ? `${run.system}\n\n${ONLY_TOOLS_REACH_THEM}` : run.system,
        dynamicTools: (run.tools ?? []).map(toolSpec),
      });
      threadId = started.thread.id;
      await ask("turn/start", {
        threadId,
        model: run.model,
        effort: run.effort,
        input: [{ type: "text", text: run.prompt, text_elements: [] }],
      });
    })(),
    finished,
  ]);
  const subtype = await finished;
  await toolsDone;
  return { subtype, text, turns: toolCalls, costUsd: 0, usage: `${tokens} tokens` };
}

export async function runCodex(run: LlmRun) {
  const cwd = mkdtempSync(join(tmpdir(), "bodylang-codex-"));
  const server = openAppServer(cwd);
  try {
    return await converse(server, run, cwd);
  } finally {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}
