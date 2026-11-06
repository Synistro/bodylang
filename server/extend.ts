import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BuildStage, BuildStatus, extendActionSchema } from "../src/wire";
import { readJson } from "./http";
import { BuildRequest, fullSuite, processPath, quickChecks, SessionContext, testPath } from "./extendCheck";

const run = promisify(execFile);

// Builds a process the model doesn't have, with extendSession.ts writing it. Its two files reach the real
// repository only if every test passes, as one commit, and the running app then reloads them. The chat never
// gets any of this: all it can do is ask for a build.
const ACTION_MOST_BYTES = 1000;
const RESERVED = new Set(["api", "index", "check", "contract"]);
const ID = /^[a-z][a-z0-9_]{1,30}$/;
const WORKTREE_NAME = /^[a-z][a-z0-9_]*-\d+-\d+$/;

// What a build is made of, so a test can stand in for the model and the long suite.
export interface BuildParts {
  repo: string;
  buildsFolder: string;
  session: (context: SessionContext) => Promise<void>;
  suite: (worktree: string, signal: AbortSignal) => Promise<string | null>;
}

const git = (cwd: string, ...args: string[]) => run("git", args, { cwd }).then((result) => result.stdout);

function defaultParts(): BuildParts {
  return { repo: process.cwd(), buildsFolder: join(process.env.BODYLANG_DATA ?? join(homedir(), ".bodylang"), "builds"), session: async (context) => (await import("./extendSession")).claudeSession(context), suite: fullSuite };
}

let building: { status: BuildStatus; abort: AbortController } | null = null;
let latest: BuildStatus | null = null;

function stopBuild() {
  building?.abort.abort();
}

function dismissBuild() {
  if (!building) latest = null;
}

// A dev server that restarts mid-build leaves its copy behind. A running build of this server is left alone.
async function removeLeftovers({ repo, buildsFolder }: BuildParts) {
  const left = readdirSync(buildsFolder).filter((name) => WORKTREE_NAME.test(name) && !name.includes(`-${process.pid}-`));
  for (const name of left) await removeWorktree(repo, join(buildsFolder, name));
}

async function removeWorktree(repo: string, worktree: string) {
  await git(repo, "worktree", "remove", "--force", worktree).catch(() => rmSync(worktree, { recursive: true, force: true }));
  await git(repo, "worktree", "prune").catch(() => undefined);
}

// A commit can fail, such as when another session holds the index. Then nothing stays behind for the app to load.
async function landFiles(repo: string, worktree: string, paths: string[], message: string) {
  for (const path of paths) copyFileSync(join(worktree, path), join(repo, path));
  try {
    await git(repo, "add", "--", ...paths);
    await git(repo, "commit", "-m", message, "--", ...paths);
  } catch (e: unknown) {
    await git(repo, "reset", "-q", "--", ...paths).catch(() => undefined);
    for (const path of paths) rmSync(join(repo, path), { force: true });
    throw e;
  }
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
    await removeLeftovers(parts);
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
    const quick = await quickChecks(worktree, id, signal);
    if (signal.aborted) return say("stopped");
    if (quick) return say("failed", firstLine(quick));
    const suite = await parts.suite(worktree, signal);
    if (signal.aborted) return say("stopped");
    if (suite) return say("failed", `It broke other tests. ${firstLine(suite)}`);

    await landFiles(parts.repo, worktree, expected, `Add process: ${title}`);
    return say("ready");
  } catch (e: unknown) {
    if (signal.aborted) return say("stopped");
    return say("failed", e instanceof Error ? e.message : String(e));
  } finally {
    await removeWorktree(parts.repo, worktree);
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

export async function handleExtend(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET") {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(latest));
    return;
  }
  const action = extendActionSchema.parse(await readJson(req, ACTION_MOST_BYTES));
  if (action.action === "stop") stopBuild();
  else if (action.action === "dismiss") dismissBuild();
  else await removeProcess(action.id);
  res.statusCode = 204;
  res.end();
}
