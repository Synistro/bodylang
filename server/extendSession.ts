import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { claudeDefaults } from "./claude";
import {
  BuildRequest,
  SessionContext,
  checkSource,
  EXTENSIONS_FOLDER,
  processPath,
  PROCESS_IMPORTS,
  quickChecks,
  testImports,
  testPath,
} from "./extendCheck";

// A separate Claude Code session adds a process the model doesn't have. It works in a throwaway copy of
// the repository and can write exactly two files there.
const MODEL = process.env.BODYLANG_BUILD_MODEL ?? "claude-opus-5-5";
const MOST_TURNS = 40;
const MOST_DOLLARS = 6;
const READ_MOST_CHARS = 60_000;

function buildPrompt({ id, title, what }: BuildRequest): string {
  return `You are adding one process to Bodylang, a 3D simulation of a person's body. The chat session found that someone asked about something the model doesn't have, and you are writing it, so it can appear on the body.

What they want to understand: ${what}
Process: ${title}, with the id ${id}.

A deterministic physiology model computes the day minute by minute. You are adding a line through the body: numbered stops along real vessels, each with a reading and a sentence, following the model's curves and the clock. A process reads the model and can't change it. It is shown to the person as written by Claude, with your source beside it, so it has to be honest about what it knows.

Write two files, with write_process and write_test:

1. ${processPath(id)}, which exports \`extension\` as a ProcessExtension. Read ${EXTENSIONS_FOLDER}/api.ts first: it is the whole contract. Its only import may be from "./api".
2. ${testPath(id)}, with at least three tests that run the real model with simulate() and check behaviour you can trace to your source, such as when a daily rhythm peaks or how a hormone responds to a logged illness. Don't test your own arithmetic back at itself. It may import from ${testImports(
    id,
  )
    .map((path) => `"${path}"`)
    .join(", ")}.

Also read these, for what you can use:
- SERIES in src/model/engine/trajectory.ts: every curve \`view.value\` can read, such as "temperature", "hoursAwake", "stressLevel", "inflammation", "glucose".
- ROUTE_IDS in src/model/ids.ts and an example such as alertnessProcess in src/model/processes/body.ts: the vessels a line can follow, and how a good process reads. "to_neck" ends at the throat, for something in the neck.
- src/model/extensions/contract.test.ts: a small working sample, and everything the contract checks.

How it should be:
- Use published physiology and name the studies in \`source\`. Set \`evidence\` honestly: use C unless the numbers come from consistent human studies. If you are unsure of a study, say it is your estimate rather than citing it.
- Put every tunable number in \`params\`, and read it from there. Use params defined above the extension as a const.
- Follow what the model really computes. Use its curves where they relate, such as inflammation during an illness or the clock for a daily rhythm. Say plainly what the model doesn't capture.
- Pick \`organ\` from the real organs where a stop sits on one, and otherwise null with a route, so it sits where the route ends. There are no meshes for anything else.
- Every sentence is plain words for someone with no medical training. Say "you may feel", never "you should feel". Never diagnose, name a condition they have, or recommend a dose. Headlines are under 14 words, and each \`say\` is at most 25. Avoid "not just", "rather than" and "not only".
- Nothing random or stateful: the same minute always gives the same answer.
- Only those two files can change, so if a test you didn't write fails, the fix is in your process, and the failure says what it wants.

Call run_checks after writing, fix whatever it reports, and call finish once it passes. Only finish after a clean run_checks. If you can't make it pass, call finish anyway and say why.`;
}

// The session's whole world: read the repository, write its two files, and run the checks.
function createClaudeSession(context: SessionContext) {
  const { worktree, id, stage, signal } = context;
  const inside = (path: string) => {
    const full = resolve(worktree, path);
    const rel = relative(worktree, full);
    if (rel.startsWith("..") || rel.split(sep).includes("node_modules") || rel.split(sep).includes(".git"))
      throw new Error(`${path} is outside what you can read`);
    return full;
  };
  const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], isError });
  const write = (path: string, code: string, imports: readonly string[]) => {
    writeFileSync(join(worktree, path), code);
    const problems = checkSource(code, imports);
    return text(problems.length ? `Written, but it won't pass:\n${problems.join("\n")}` : `Written to ${path}.`);
  };
  return createSdkMcpServer({
    name: "build",
    version: "0.0.0",
    tools: [
      tool("list_files", "Lists one folder of the repository.", { folder: z.string() }, async ({ folder }) => {
        try {
          const full = inside(folder);
          return text(
            readdirSync(full)
              .filter((name) => name !== "node_modules" && name !== ".git")
              .map((name) => (statSync(join(full, name)).isDirectory() ? `${name}/` : name))
              .join("\n"),
          );
        } catch (e: unknown) {
          return text(e instanceof Error ? e.message : String(e), true);
        }
      }),
      tool(
        "read_file",
        "Reads one file of the repository, by its path from the root.",
        { path: z.string() },
        async ({ path }) => {
          try {
            return text(readFileSync(inside(path), "utf8").slice(0, READ_MOST_CHARS));
          } catch (e: unknown) {
            return text(e instanceof Error ? e.message : String(e), true);
          }
        },
      ),
      tool(
        "write_process",
        `Writes the whole of ${processPath(id)}, replacing what was there.`,
        { code: z.string().min(1) },
        async ({ code }) => write(processPath(id), code, PROCESS_IMPORTS),
      ),
      tool(
        "write_test",
        `Writes the whole of ${testPath(id)}, replacing what was there.`,
        { code: z.string().min(1) },
        async ({ code }) => write(testPath(id), code, testImports(id)),
      ),
      tool(
        "run_checks",
        "Checks both files, the types, and the tests a new process can affect. Returns what to fix, or that it passed.",
        {},
        async () => {
          stage("testing");
          const problem = await quickChecks(worktree, id, signal);
          stage("writing");
          return text(problem ?? "Passed. Call finish.", problem !== null);
        },
      ),
      tool(
        "finish",
        "Ends the session. The app then runs every test before anything is added.",
        { summary: z.string() },
        async () => text("Done."),
      ),
    ],
  });
}

export async function claudeSession(context: SessionContext) {
  const abortController = new AbortController();
  context.signal.addEventListener("abort", () => abortController.abort());
  const session = query({
    prompt: buildPrompt(context),
    options: {
      ...claudeDefaults(),
      model: MODEL,
      effort: "medium",
      maxTurns: MOST_TURNS,
      maxBudgetUsd: MOST_DOLLARS,
      cwd: context.worktree,
      systemPrompt:
        "You add one process at a time to a physiology model. You can only use the tools you are given, and you work until run_checks passes.",
      allowedTools: ["mcp__build__*"],
      mcpServers: { build: createClaudeSession(context) },
      abortController,
    },
  });
  for await (const message of session) {
    if (message.type === "result")
      console.log(
        `[bodylang] build of ${context.id}: ${message.subtype}, ${message.num_turns} turns, $${message.total_cost_usd.toFixed(3)}`,
      );
  }
}
