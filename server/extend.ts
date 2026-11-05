import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { cleanEnvironment } from "./claudeEnv";
import { checkShape, checkSource, PROCESS_IMPORTS, testImports } from "./extendCheck";

const run = promisify(execFile);

// A separate Claude Code session adds a process the model doesn't have. It works in a throwaway copy of
// the repository and can write exactly two files there. Those reach the real repository only if every test
// passes, as one commit, and the running app then reloads them. The chat never gets any of this: all it can
// do is ask for a build.
const MODEL = process.env.BODYLANG_BUILD_MODEL ?? "claude-opus-5-5";
const MOST_TURNS = 40;
const MOST_DOLLARS = 6;
const CHECK_TIMEOUT_MS = 180_000;
const SUITE_TIMEOUT_MS = 420_000;
const OUTPUT_KEPT_CHARS = 6000;
const READ_MOST_CHARS = 60_000;
const EXTENSIONS_FOLDER = "src/model/extensions";
const RESERVED = new Set(["api", "index", "check", "contract"]);
const ID = /^[a-z][a-z0-9_]{1,30}$/;

export type BuildStage = "writing" | "testing" | "final" | "ready" | "failed" | "stopped";

export interface BuildStatus {
  id: string;
  title: string;
  stage: BuildStage;
  message: string | null;
}

export interface BuildRequest {
  id: string;
  title: string;
  what: string; // what the person wants to understand, in Claude's words
}

interface SessionContext extends BuildRequest {
  worktree: string;
  stage: (stage: BuildStage) => void;
  signal: AbortSignal;
}

// What a build is made of, so a test can stand in for the model and the long suite.
export interface BuildParts {
  repo: string;
  buildsFolder: string;
  session: (context: SessionContext) => Promise<void>;
  suite: (worktree: string) => Promise<string | null>;
}

const processPath = (id: string) => `${EXTENSIONS_FOLDER}/${id}.ts`;
const testPath = (id: string) => `${EXTENSIONS_FOLDER}/${id}.test.ts`;

async function shell(command: string, args: string[], cwd: string, timeout: number): Promise<string | null> {
  try {
    await run(command, args, { cwd, timeout, maxBuffer: 20_000_000 });
    return null;
  } catch (e: unknown) {
    const failure = e as { stdout?: string; stderr?: string; message?: string };
    const text = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim() || failure.message || "It failed with no output";
    return text.slice(-OUTPUT_KEPT_CHARS);
  }
}

const git = (cwd: string, ...args: string[]) => run("git", args, { cwd }).then((result) => result.stdout);

// What the session can check while it works: the two files, the types, and the tests a new process can
// affect. Each failure reads as what to fix.
export async function quickChecks(worktree: string, id: string): Promise<string | null> {
  const code = join(worktree, processPath(id));
  const test = join(worktree, testPath(id));
  if (!existsSync(code)) return "The process file hasn't been written yet.";
  if (!existsSync(test)) return "The test file hasn't been written yet.";
  const processCode = readFileSync(code, "utf8");
  const testCode = readFileSync(test, "utf8");
  const reasons = [...checkShape(processCode, testCode), ...checkSource(processCode, PROCESS_IMPORTS).map((p) => `Process file, ${p}`), ...checkSource(testCode, testImports(id)).map((p) => `Test file, ${p}`)];
  if (reasons.length) return reasons.join("\n");
  const types = await shell("node_modules/.bin/tsc", ["--noEmit", "-p", "."], worktree, CHECK_TIMEOUT_MS);
  if (types) return `Type check failed:\n${types}`;
  const tests = await shell("node_modules/.bin/vitest", ["run", EXTENSIONS_FOLDER, "src/model/copy.test.ts", "src/model/processes.test.ts"], worktree, CHECK_TIMEOUT_MS);
  return tests ? `Tests failed:\n${tests}` : null;
}

const fullSuite = (worktree: string) => shell("node_modules/.bin/vitest", ["run"], worktree, SUITE_TIMEOUT_MS);

function buildPrompt({ id, title, what }: BuildRequest): string {
  return `You are adding one process to Bodylang, a 3D simulation of a person's body. The chat session found that someone asked about something the model doesn't have, and you are writing it, so it can appear on the body.

What they want to understand: ${what}
Process: ${title}, with the id ${id}.

A deterministic physiology model computes the day minute by minute. You are adding a line through the body: numbered stops along real vessels, each with a reading and a sentence, following the model's curves and the clock. A process reads the model and can't change it. It is shown to the person as written by Claude, with your source beside it, so it has to be honest about what it knows.

Write two files, with write_process and write_test:

1. ${processPath(id)}, which exports \`extension\` as a ProcessExtension. Read ${EXTENSIONS_FOLDER}/api.ts first: it is the whole contract. Its only import may be from "./api".
2. ${testPath(id)}, with at least three tests that run the real model with simulate() and check behaviour you can trace to your source, such as when a daily rhythm peaks or how a hormone responds to a logged illness. Don't test your own arithmetic back at itself. It may import from "vitest", "./api", "./check", "./${id}", "../simulate", "../params", "../cycle" and "../processes".

Also read these, for what you can use:
- SERIES in src/model/simulate.ts: every curve \`view.value\` can read, such as "temperature", "hoursAwake", "stressLevel", "inflammation", "glucose".
- ROUTE_IDS and an example such as alertnessProcess in src/model/processes.ts: the vessels a line can follow, and how a good process reads. "to_neck" ends at the throat, for something in the neck.
- src/model/extensions/contract.test.ts: a small working sample, and everything the contract checks.

How it should be:
- Use published physiology and name the studies in \`source\`. Set \`evidence\` honestly: use C unless the numbers come from consistent human studies. If you are unsure of a study, say it is your estimate rather than citing it.
- Put every tunable number in \`params\`, and read it from there. Use params defined above the extension as a const.
- Follow what the model really computes. Use its curves where they relate, such as inflammation during an illness or the clock for a daily rhythm. Say plainly what the model doesn't capture.
- Pick \`organ\` from the real organs where a stop sits on one, and otherwise null with a route, so it sits where the route ends. There are no meshes for anything else.
- Every sentence is plain words for someone with no medical training. Say "you may feel", never "you should feel". Never diagnose, name a condition they have, or recommend a dose. Headlines are under 14 words, and each \`say\` is at most 32.
- Nothing random or stateful: the same minute always gives the same answer.

Call run_checks after writing, fix whatever it reports, and call finish once it passes. Only finish after a clean run_checks. If you can't make it pass, call finish anyway and say why.`;
}

// The session's whole world: read the repository, write its two files, and run the checks.
function createClaudeSession(context: SessionContext) {
  const { worktree, id, stage } = context;
  const inside = (path: string) => {
    const full = resolve(worktree, path);
    const rel = relative(worktree, full);
    if (rel.startsWith("..") || rel.split(sep).includes("node_modules") || rel.split(sep).includes(".git")) throw new Error(`${path} is outside what you can read`);
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
          return text(readdirSync(full).filter((name) => name !== "node_modules" && name !== ".git").map((name) => (statSync(join(full, name)).isDirectory() ? `${name}/` : name)).join("\n"));
        } catch (e: unknown) {
          return text(e instanceof Error ? e.message : String(e), true);
        }
      }),
      tool("read_file", "Reads one file of the repository, by its path from the root.", { path: z.string() }, async ({ path }) => {
        try {
          return text(readFileSync(inside(path), "utf8").slice(0, READ_MOST_CHARS));
        } catch (e: unknown) {
          return text(e instanceof Error ? e.message : String(e), true);
        }
      }),
      tool("write_process", `Writes the whole of ${processPath(id)}, replacing what was there.`, { code: z.string().min(1) }, async ({ code }) => write(processPath(id), code, PROCESS_IMPORTS)),
      tool("write_test", `Writes the whole of ${testPath(id)}, replacing what was there.`, { code: z.string().min(1) }, async ({ code }) => write(testPath(id), code, testImports(id))),
      tool("run_checks", "Checks both files, the types, and the tests a new process can affect. Returns what to fix, or that it passed.", {}, async () => {
        stage("testing");
        const problem = await quickChecks(worktree, id);
        stage("writing");
        return text(problem ?? "Passed. Call finish.", problem !== null);
      }),
      tool("finish", "Ends the session. The app then runs every test before anything is added.", { summary: z.string() }, async () => text("Done.")),
    ],
  });
}

async function claudeSession(context: SessionContext) {
  const abortController = new AbortController();
  context.signal.addEventListener("abort", () => abortController.abort());
  const session = query({
    prompt: buildPrompt(context),
    options: {
      model: MODEL,
      effort: "medium",
      maxTurns: MOST_TURNS,
      maxBudgetUsd: MOST_DOLLARS,
      cwd: context.worktree,
      systemPrompt: "You add one process at a time to a physiology model. You can only use the tools you are given, and you work until run_checks passes.",
      tools: [],
      allowedTools: ["mcp__build__*"],
      mcpServers: { build: createClaudeSession(context) },
      settingSources: [],
      persistSession: false,
      permissionMode: "dontAsk",
      env: cleanEnvironment(),
      abortController,
    },
  });
  for await (const message of session) {
    if (message.type === "result") console.log(`[bodylang] build of ${context.id}: ${message.subtype}, ${message.num_turns} turns, $${message.total_cost_usd.toFixed(3)}`);
  }
}

function defaultParts(): BuildParts {
  return { repo: process.cwd(), buildsFolder: join(process.env.BODYLANG_DATA ?? join(homedir(), ".bodylang"), "builds"), session: claudeSession, suite: fullSuite };
}

let building: { status: BuildStatus; abort: AbortController } | null = null;
let latest: BuildStatus | null = null;

export const buildStatus = () => latest;

export function stopBuild() {
  building?.abort.abort();
}

export function dismissBuild() {
  if (!building) latest = null;
}

// Everything between the request and the commit. Whatever happens, the copy is removed, and the only
// thing that ever reaches the real repository is the two files of a build that passed.
export async function runBuild(request: BuildRequest, parts: BuildParts, notify: (status: BuildStatus) => void, signal: AbortSignal): Promise<BuildStatus> {
  const { id, title } = request;
  const say = (stage: BuildStage, message: string | null = null): BuildStatus => {
    const status = { id, title, stage, message };
    latest = status;
    notify(status);
    return status;
  };
  const worktree = join(parts.buildsFolder, `${id}-${process.pid}-${Date.now()}`);
  mkdirSync(parts.buildsFolder, { recursive: true });
  say("writing");
  try {
    await git(parts.repo, "worktree", "add", "--detach", worktree, "HEAD");
    const modules = join(parts.repo, "node_modules");
    if (existsSync(modules)) symlinkSync(modules, join(worktree, "node_modules"));
    await parts.session({ ...request, worktree, stage: (stage) => say(stage), signal });
    if (signal.aborted) return say("stopped");

    say("final");
    const changed = (await git(worktree, "status", "--porcelain", "--untracked-files=all")).split("\n").filter(Boolean).map((line) => line.slice(3));
    const expected = [processPath(id), testPath(id)];
    const extra = changed.filter((path) => !expected.includes(path));
    if (extra.length) return say("failed", `It changed files it shouldn't have: ${extra.join(", ")}.`);
    const quick = await quickChecks(worktree, id);
    if (quick) return say("failed", firstLine(quick));
    const suite = await parts.suite(worktree);
    if (signal.aborted) return say("stopped");
    if (suite) return say("failed", `It broke other tests. ${firstLine(suite)}`);

    for (const path of expected) copyFileSync(join(worktree, path), join(parts.repo, path));
    await git(parts.repo, "add", "--", ...expected);
    await git(parts.repo, "commit", "-m", `Add process: ${title}`, "--", ...expected);
    return say("ready");
  } catch (e: unknown) {
    if (signal.aborted) return say("stopped");
    return say("failed", e instanceof Error ? e.message : String(e));
  } finally {
    await git(parts.repo, "worktree", "remove", "--force", worktree).catch(() => rmSync(worktree, { recursive: true, force: true }));
    await git(parts.repo, "worktree", "prune").catch(() => undefined);
  }
}

const firstLine = (text: string) => text.split("\n").find((line) => line.trim()) ?? text;

export type StartResult = { started: true } | { started: false; reason: string };

// One at a time. The answer goes back to the chat, which only tells the person.
export function startBuild(request: BuildRequest, notify: (status: BuildStatus) => void, parts: BuildParts = defaultParts()): StartResult {
  if (building) return { started: false, reason: `${building.status.title} is still being added. Only one can be built at a time.` };
  if (!ID.test(request.id) || RESERVED.has(request.id)) return { started: false, reason: `The id "${request.id}" must be lowercase letters and underscores, and not one of ${[...RESERVED].join(", ")}.` };
  if (existsSync(join(parts.repo, processPath(request.id)))) return { started: false, reason: `${request.title} already exists, as ext:${request.id}.` };
  const abort = new AbortController();
  building = { status: { id: request.id, title: request.title, stage: "writing", message: null }, abort };
  void runBuild(request, parts, notify, abort.signal).finally(() => {
    building = null;
  });
  return { started: true };
}

// Taking one out is a commit too, so it can be brought back.
export async function removeProcess(id: string, repo = process.cwd()) {
  if (!ID.test(id) || RESERVED.has(id)) throw new Error(`Not a process: ${id}`);
  const paths = [processPath(id), testPath(id)];
  if (!existsSync(join(repo, paths[0]))) throw new Error(`There is no process ${id}`);
  await git(repo, "rm", "-f", "--", ...paths);
  await git(repo, "commit", "-m", `Remove process: ${id}`, "--", ...paths);
}

const actionSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("stop") }), z.object({ action: z.literal("dismiss") }), z.object({ action: z.literal("remove"), id: z.string() })]);

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function handleExtend(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET") {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(latest));
    return;
  }
  if (req.method !== "POST" || !req.headers["content-type"]?.includes("application/json")) {
    res.statusCode = 405;
    res.end();
    return;
  }
  const action = actionSchema.parse(await readJson(req));
  if (action.action === "stop") stopBuild();
  else if (action.action === "dismiss") dismissBuild();
  else await removeProcess(action.id);
  res.statusCode = 204;
  res.end();
}
