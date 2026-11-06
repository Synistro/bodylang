import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BuildStage } from "../src/wire";
import { parseAst } from "vite";

const run = promisify(execFile);

// A new process is code that runs in your browser and on your Mac, so before anything runs it, this reads
// it and rejects anything that reaches past the contract: other files, the network, storage, or the page.
// This catches honest mistakes and is no sandbox. A property name held in a variable still gets through, and
// real containment would need a container. It only ever reads code that Claude wrote for your own request.
const CANT_TOUCH = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "eval",
  "Function",
  "require",
  "process",
  "globalThis",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "navigator",
  "self",
  "importScripts",
  "Deno",
  "Bun",
  "global",
  "__dirname",
  "__filename",
  "constructor",
  "__proto__",
  "prototype",
  "Reflect",
  "Proxy",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "Worker",
  "Image",
  "Audio",
  "location",
  "top",
  "parent",
  "opener",
  "frames",
  "postMessage",
  "vi",
]);
const FROM_VITEST = new Set(["it", "expect", "describe"]);

export const PROCESS_IMPORTS = ["./api"];
// What a test of a new process needs to run the real model. Paths are from src/model/extensions.
const MODEL_FOR_TESTS = [
  "../engine/simulate",
  "../scenario",
  "../engine/trajectory",
  "../params",
  "../cycle",
  "../processes/processes",
];
export const testImports = (id: string) => ["vitest", "./api", "./check", `./${id}`, ...MODEL_FOR_TESTS];

interface Node {
  type: string;
  start?: number;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";

// "con" + "structor" or a template reach the same place as the name itself. Arithmetic, as in stops[i + 1], is fine.
function buildsAString(key: Node): boolean {
  if (key.type === "TemplateLiteral") return true;
  if (key.type === "Literal") return typeof key.value === "string";
  return key.type === "BinaryExpression" && (buildsAString(key.left as Node) || buildsAString(key.right as Node));
}

function each(node: Node, visit: (child: Node) => void) {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) each(item, visit);
    } else if (isNode(value)) each(value, visit);
  }
}

export function checkSource(text: string, allowedImports: readonly string[]): string[] {
  let program: Node;
  try {
    program = parseAst(text, { lang: "ts" }) as unknown as Node;
  } catch (e: unknown) {
    return [`it doesn't parse: ${e instanceof Error ? e.message : String(e)}`];
  }
  const problems = new Set<string>();
  const place = (node: Node) => `line ${text.slice(0, node.start ?? 0).split("\n").length}`;
  each(program, (node) => {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration": {
        const from = (node.source as { value?: unknown } | null | undefined)?.value;
        if (typeof from === "string" && !allowedImports.includes(from))
          problems.add(`${place(node)}: it can't import "${from}". It can import only ${allowedImports.join(", ")}`);
        if (from === "vitest" && node.type === "ImportDeclaration") {
          for (const specifier of node.specifiers as Node[]) {
            const name = (specifier.imported as { name?: string } | undefined)?.name;
            if (!name || !FROM_VITEST.has(name))
              problems.add(`${place(node)}: from vitest it can import only ${[...FROM_VITEST].join(", ")}`);
          }
        }
        break;
      }
      case "ImportExpression":
        problems.add(`${place(node)}: it can't load anything at run time`);
        break;
      case "MetaProperty":
        problems.add(`${place(node)}: it can't use import.meta`);
        break;
      case "TSImportEqualsDeclaration":
        problems.add(`${place(node)}: it can't use import =`);
        break;
      case "Identifier":
        if (CANT_TOUCH.has(node.name as string)) problems.add(`${place(node)}: it can't use ${node.name as string}`);
        break;
      case "MemberExpression": {
        const key = node.property as Node;
        if (node.computed !== true) break;
        if (key.type === "Literal" && CANT_TOUCH.has(String(key.value)))
          problems.add(`${place(node)}: it can't use ${String(key.value)}`);
        else if (key.type !== "Literal" && buildsAString(key))
          problems.add(`${place(node)}: it can't work out a property name from strings`);
        break;
      }
      default:
    }
  });
  return [...problems];
}

const TESTS_LEAST = 3;

// A test file has to test something, and an extension has to export what the app looks for.
export function checkShape(processCode: string, testCode: string): string[] {
  const problems: string[] = [];
  if (!/export const extension\b/.test(processCode))
    problems.push("The process file must have `export const extension: ProcessExtension = {...}`");
  const tests = (testCode.match(/\bit(?:\.each\([^)]*\))?\(/g) ?? []).length;
  if (tests < TESTS_LEAST)
    problems.push(
      `The test file has ${tests} tests, and needs at least ${TESTS_LEAST}, checking its behaviour against its source`,
    );
  if (!/simulate\(/.test(testCode)) problems.push("The tests must run the real model with simulate()");
  return problems;
}

export interface BuildRequest {
  id: string;
  title: string;
  what: string; // what the person wants to understand, in Claude's words
}

export interface SessionContext extends BuildRequest {
  worktree: string;
  stage: (stage: BuildStage) => void;
  signal: AbortSignal;
}

export const EXTENSIONS_FOLDER = "src/model/extensions";
const CHECK_TIMEOUT_MS = 180_000;
const SUITE_TIMEOUT_MS = 420_000;
const OUTPUT_KEPT_CHARS = 6000;

export const processPath = (id: string) => `${EXTENSIONS_FOLDER}/${id}.ts`;
export const testPath = (id: string) => `${EXTENSIONS_FOLDER}/${id}.test.ts`;

// The checks run code Claude just wrote, so they get nothing from this process's environment but a way to run.
const checkEnvironment = () => ({ PATH: process.env.PATH, HOME: process.env.HOME });

async function shell(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    await run(command, args, { cwd, timeout, maxBuffer: 20_000_000, signal, env: checkEnvironment() });
    return null;
  } catch (e: unknown) {
    const failure = e as { stdout?: string; stderr?: string; message?: string };
    const text =
      `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim() || failure.message || "It failed with no output";
    return text.slice(-OUTPUT_KEPT_CHARS);
  }
}

// What the session can check while it works: the two files, the types, and the tests a new process can
// affect. Each failure reads as what to fix.
export async function quickChecks(worktree: string, id: string, signal: AbortSignal): Promise<string | null> {
  const code = join(worktree, processPath(id));
  const test = join(worktree, testPath(id));
  if (!existsSync(code)) return "The process file hasn't been written yet.";
  if (!existsSync(test)) return "The test file hasn't been written yet.";
  const processCode = readFileSync(code, "utf8");
  const testCode = readFileSync(test, "utf8");
  const reasons = [
    ...checkShape(processCode, testCode),
    ...checkSource(processCode, PROCESS_IMPORTS).map((p) => `Process file, ${p}`),
    ...checkSource(testCode, testImports(id)).map((p) => `Test file, ${p}`),
  ];
  if (reasons.length) return reasons.join("\n");
  const types = await shell("node_modules/.bin/tsc", ["--noEmit", "-p", "."], worktree, CHECK_TIMEOUT_MS, signal);
  if (types) return `Type check failed:\n${types}`;
  const tests = await shell(
    "node_modules/.bin/vitest",
    [
      "run",
      EXTENSIONS_FOLDER,
      "src/model/copy.test.ts",
      "src/model/processes/processes.test.ts",
      "src/model/events/events.test.ts",
    ],
    worktree,
    CHECK_TIMEOUT_MS,
    signal,
  );
  return tests ? `Tests failed:\n${tests}` : null;
}

export const fullSuite = (worktree: string, signal: AbortSignal) =>
  shell("node_modules/.bin/vitest", ["run"], worktree, SUITE_TIMEOUT_MS, signal);
