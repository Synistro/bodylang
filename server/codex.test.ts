import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { CODEX_HOME, converse, lockdownArgs, toolSpec, withoutEditsOrSubAgents } from "./codex";
import type { AppServer } from "./codex";
import type { LlmRun, LlmTool } from "./llm";

const FEATURES = `shell_tool                 stable             true
unified_exec               stable             true
code_mode_host             stable             true
apps                       stable             true
`;

describe("what a Codex session may reach", () => {
  const args = lockdownArgs(FEATURES, "/tmp/models.json");

  it("turns off every feature Codex lists, apart from the sandbox tools run in", () => {
    expect(args).toContain("features.shell_tool=false");
    expect(args).toContain("features.unified_exec=false");
    expect(args).toContain("features.apps=false");
    expect(args.join(" ")).not.toContain("code_mode_host");
  });

  it("turns off web search, project instructions, skills and analytics", () => {
    for (const setting of [
      'web_search="disabled"',
      "project_doc_max_bytes=0",
      "skills.include_instructions=false",
      "skills.bundled.enabled=false",
      "analytics.enabled=false",
    ])
      expect(args).toContain(setting);
  });

  it("removes file edits and sub-agents from each model", () => {
    const [model] = withoutEditsOrSubAgents({
      models: [
        { slug: "m", apply_patch_tool_type: "freeform", multi_agent_version: "v2", multi_agent_reasoning_effort: "x" },
      ],
    }).models;
    expect(model).toEqual({ slug: "m", apply_patch_tool_type: null, multi_agent_version: null });
  });

  it("logs in to the same Codex home the sessions run in", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
    expect(scripts["login:openai"]).toBe("node tools/login-openai.mjs");
    expect(readFileSync("tools/login-openai.mjs", "utf8")).toContain('join(homedir(), ".bodylang", "codex")');
    expect(CODEX_HOME).toBe(join(homedir(), ".bodylang", "codex"));
  });
});

// Stands in for Codex: it answers each request, and the test plays the rest of the conversation.
function fakeServer(answers: Record<string, unknown>, play: (say: (message: object) => void, sent: any[]) => void) {
  const sent: any[] = [];
  let receive: (message: any) => void = () => {};
  const server: AppServer = {
    send: (message: any) => {
      sent.push(message);
      if (message.method && message.id !== undefined) {
        if (message.method in answers) receive({ id: message.id, result: answers[message.method] });
        if (message.method === "turn/start") play(receive, sent);
      }
    },
    onMessage: (listener) => {
      receive = listener;
    },
    onExit: () => {},
    close: () => {},
  };
  return { server, sent };
}

const LOGGED_IN = {
  initialize: {},
  "account/read": { account: { type: "chatgpt" } },
  "thread/start": { thread: { id: "t" } },
  "turn/start": {},
};
const completed = { method: "turn/completed", params: { turn: { status: "completed" } } };
const run = (tools: LlmTool[] = []): LlmRun => ({
  system: "s",
  prompt: "p",
  model: "m",
  effort: "low",
  maxTurns: 2,
  tools,
  abort: new AbortController(),
});

describe("a conversation with Codex", () => {
  it("runs tool calls in the order they arrive, even when an early one is slow", async () => {
    const order: string[] = [];
    const tool = (name: string, wait: number): LlmTool => ({
      name,
      description: "",
      inputSchema: { n: z.number() },
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, wait));
        order.push(name);
        return { content: [{ type: "text", text: `${name} done` }] };
      },
    });
    const { server, sent } = fakeServer(LOGGED_IN, (say) => {
      say({ id: 90, method: "item/tool/call", params: { tool: "slow", arguments: { n: 1 } } });
      say({ id: 91, method: "item/tool/call", params: { tool: "fast", arguments: { n: 2 } } });
      say(completed);
    });
    const result = await converse(server, run([tool("slow", 20), tool("fast", 0)]), "/tmp");
    expect(order).toEqual(["slow", "fast"]);
    expect(result).toMatchObject({ subtype: "success", turns: 2 });
    expect(sent.find((m) => m.id === 90).result).toEqual({
      contentItems: [{ type: "inputText", text: "slow done" }],
      success: true,
    });
  });

  it("tells the model when its input doesn't fit, and doesn't run the tool", async () => {
    let ran = false;
    const tool: LlmTool = {
      name: "strict",
      description: "",
      inputSchema: { n: z.number() },
      handler: async () => {
        ran = true;
        return { content: [] };
      },
    };
    const { server, sent } = fakeServer(LOGGED_IN, (say) => {
      say({ id: 90, method: "item/tool/call", params: { tool: "strict", arguments: { n: "one" } } });
      say(completed);
    });
    await converse(server, run([tool]), "/tmp");
    expect(ran).toBe(false);
    expect(sent.find((m) => m.id === 90).result.success).toBe(false);
  });

  it("refuses anything from Codex that isn't one of Bodylang's tools", async () => {
    const { server, sent } = fakeServer(LOGGED_IN, (say) => {
      say({ id: 90, method: "item/commandExecution/requestApproval", params: {} });
      say(completed);
    });
    await converse(server, run(), "/tmp");
    expect(sent.find((m) => m.id === 90).error).toBeDefined();
  });

  it("collects streamed words and says when it is logged out or a turn fails", async () => {
    const words: string[] = [];
    const talking = fakeServer(LOGGED_IN, (say) => {
      say({ method: "item/agentMessage/delta", params: { delta: "Hel" } });
      say({ method: "item/agentMessage/delta", params: { delta: "lo" } });
      say(completed);
    });
    const said = await converse(talking.server, { ...run(), onText: (text) => words.push(text) }, "/tmp");
    expect(said.text).toBe("Hello");
    expect(words).toEqual(["Hel", "lo"]);

    const out = fakeServer({ ...LOGGED_IN, "account/read": { account: null } }, () => {});
    await expect(converse(out.server, run(), "/tmp")).rejects.toThrow(/Not logged in/);

    const failing = fakeServer(LOGGED_IN, (say) =>
      say({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "No quota" } } } }),
    );
    await expect(converse(failing.server, run(), "/tmp")).rejects.toThrow("No quota");
  });

  it("describes a tool in a form Codex can read", () => {
    const spec = toolSpec({
      name: "t",
      description: "d",
      inputSchema: { n: z.number() },
      handler: async () => ({ content: [] }),
    });
    expect(spec).toMatchObject({ type: "function", name: "t", description: "d" });
    expect(spec.inputSchema).toMatchObject({ type: "object", required: ["n"] });
  });

  it("declares a field with many shapes as an object, and puts the full schema in the description", () => {
    const spec = toolSpec({
      name: "t",
      description: "d",
      inputSchema: {
        shape: z.discriminatedUnion("kind", [z.object({ kind: z.literal("a") }), z.object({ kind: z.literal("b") })]),
      },
      handler: async () => ({ content: [] }),
    });
    expect(JSON.stringify(spec.inputSchema)).not.toContain("oneOf");
    expect(spec.description).toMatch(/^d\n\nIts full input, as JSON Schema:\n.*oneOf/s);
  });
});
