import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Everything here is real except Claude and the two suites: real git, a real worktree and a real commit,
// in a small repository of its own.

import type { BuildStatus } from "../src/wire";
import { BuildParts, removeProcess, runBuild } from "./extend";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const GOOD_PROCESS = 'import type { ProcessExtension } from "./api";\nexport const extension: ProcessExtension = {} as ProcessExtension;\n';
const GOOD_TEST = 'import { it } from "vitest";\nimport { simulate } from "../engine/simulate";\nit("a", () => { simulate; });\nit("b", () => {});\nit("c", () => { simulate(0 as never); });\n';

describe("building a process", () => {
  let repo: string;
  let builds: string;
  const statuses: BuildStatus[] = [];
  const request = { id: "thyroid", title: "Thyroid", what: "How my thyroid works" };
  const go = (parts: Partial<BuildParts>, signal = new AbortController().signal) =>
    runBuild(request, { repo, buildsFolder: builds, session: async () => undefined, suite: async () => null, ...parts }, (s) => statuses.push(s), signal);
  const writes =
    (processCode = GOOD_PROCESS, testCode = GOOD_TEST): BuildParts["session"] =>
    async ({ worktree }) => {
      writeFileSync(join(worktree, "src/model/extensions/thyroid.ts"), processCode);
      writeFileSync(join(worktree, "src/model/extensions/thyroid.test.ts"), testCode);
    };

  beforeEach(() => {
    statuses.length = 0;
    repo = mkdtempSync(join(tmpdir(), "bodylang-repo-"));
    builds = mkdtempSync(join(tmpdir(), "bodylang-builds-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    execFileSync("mkdir", ["-p", "src/model/extensions", "node_modules/.bin"], { cwd: repo });
    writeFileSync(join(repo, ".gitignore"), "node_modules\n");
    writeFileSync(join(repo, "src/model/extensions/api.ts"), "export interface ProcessExtension { id: string }\n");
    writeFileSync(join(repo, "node_modules/.bin/tsc"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(repo, "node_modules/.bin/vitest"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(repo, "unrelated.txt"), "before\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "Start");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(builds, { recursive: true, force: true });
  });

  const added = () => existsSync(join(repo, "src/model/extensions/thyroid.ts"));
  const commits = () => git(repo, "log", "--format=%s").trim().split("\n");
  const leftovers = () => git(repo, "worktree", "list").trim().split("\n").length;

  it("adds the two files as one commit when everything passes", async () => {
    const result = await go({ session: writes() });
    expect(result.stage).toBe("ready");
    expect(added()).toBe(true);
    expect(commits()[0]).toBe("Add process: Thyroid");
    expect(git(repo, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual(["src/model/extensions/thyroid.test.ts", "src/model/extensions/thyroid.ts"]);
    expect(statuses.map((s) => s.stage)).toEqual(["writing", "final", "ready"]);
  });

  it("adds nothing when the suite fails", async () => {
    const result = await go({ session: writes(), suite: async () => "FAIL src/model/copy.test.ts\nsomething broke" });
    expect(result.stage).toBe("failed");
    expect(result.message).toMatch(/copy.test/);
    expect(added()).toBe(false);
    expect(commits()).toEqual(["Start"]);
  });

  it("adds nothing when the session writes something it shouldn't", async () => {
    const result = await go({
      session: async (context) => {
        await writes()(context);
        writeFileSync(join(context.worktree, "unrelated.txt"), "changed\n");
      },
    });
    expect(result.stage).toBe("failed");
    expect(result.message).toMatch(/unrelated.txt/);
    expect(added()).toBe(false);
    expect(readFileSync(join(repo, "unrelated.txt"), "utf8")).toBe("before\n");
  });

  it("adds nothing when the code reaches past the contract", async () => {
    const result = await go({ session: writes(`${GOOD_PROCESS}fetch("https://example.com");\n`) });
    expect(result.stage).toBe("failed");
    expect(result.message).toMatch(/fetch/);
    expect(added()).toBe(false);
  });

  it("adds nothing when the session gives up without writing", async () => {
    const result = await go({});
    expect(result.stage).toBe("failed");
    expect(added()).toBe(false);
  });

  it("reports a session that crashes, and adds nothing", async () => {
    const result = await go({ session: async () => Promise.reject(new Error("no login")) });
    expect(result).toMatchObject({ stage: "failed", message: "no login" });
    expect(added()).toBe(false);
  });

  it("stops when told to", async () => {
    const stopper = new AbortController();
    const result = await go({
      session: async (context) => {
        await writes()(context);
        stopper.abort();
      },
    }, stopper.signal);
    expect(result.stage).toBe("stopped");
    expect(added()).toBe(false);
  });

  it("leaves nothing behind when the commit itself fails", async () => {
    writeFileSync(join(repo, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = await go({ session: writes() });
    expect(result.stage).toBe("failed");
    expect(added()).toBe(false);
    expect(commits()).toEqual(["Start"]);
    expect(git(repo, "status", "--porcelain").trim()).toBe("");
  });

  it("stops when told to during the long suite", async () => {
    const stopper = new AbortController();
    const result = await go({
      session: writes(),
      suite: async () => {
        stopper.abort();
        return "killed";
      },
    }, stopper.signal);
    expect(result.stage).toBe("stopped");
    expect(added()).toBe(false);
  });

  it("clears out a copy left by a dev server that restarted", async () => {
    const left = join(builds, "melatonin-1-1");
    git(repo, "worktree", "add", "--detach", left, "HEAD");
    expect(leftovers()).toBe(2);
    await go({ session: writes() });
    expect(leftovers()).toBe(1);
    expect(existsSync(left)).toBe(false);
  });

  it("removes its copy of the repository however it ends", async () => {
    await go({ session: writes() });
    await go({ session: async () => Promise.reject(new Error("x")) });
    expect(leftovers()).toBe(1);
  });

  it("leaves work in progress in the real repository alone", async () => {
    writeFileSync(join(repo, "unrelated.txt"), "my own edit\n");
    await go({ session: writes() });
    expect(readFileSync(join(repo, "unrelated.txt"), "utf8")).toBe("my own edit\n");
    expect(git(repo, "status", "--porcelain").trim()).toBe("M unrelated.txt");
  });

  it("takes one out again as a commit, so it can be brought back", async () => {
    await go({ session: writes() });
    await removeProcess("thyroid", repo);
    expect(added()).toBe(false);
    expect(commits()[0]).toBe("Remove process: thyroid");
    await expect(removeProcess("thyroid", repo)).rejects.toThrow(/no process/);
    await expect(removeProcess("../api", repo)).rejects.toThrow(/Not a process/);
  });
});
