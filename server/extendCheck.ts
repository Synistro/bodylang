import { parseAst } from "vite";

// A new process is code that runs in your browser and on your Mac, so before anything runs it, this reads
// it and rejects anything that reaches past the contract: other files, the network, storage, or the page.
const CANT_TOUCH = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "eval", "Function", "require", "process", "globalThis", "window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator", "self", "importScripts", "Deno", "Bun", "global", "__dirname", "__filename", "constructor", "__proto__", "prototype", "Reflect", "Proxy", "setTimeout", "setInterval", "queueMicrotask", "Worker"]);

export const PROCESS_IMPORTS = ["./api"];
export const testImports = (id: string) => ["vitest", "./api", "./check", `./${id}`, "../simulate", "../params", "../cycle", "../processes"];

interface Node {
  type: string;
  start?: number;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as Node).type === "string";

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
        if (typeof from === "string" && !allowedImports.includes(from)) problems.add(`${place(node)}: it can't import "${from}". It can import only ${allowedImports.join(", ")}`);
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
        // A name spelled as a string reaches the same place, so anything worked out at run time is out too.
        const key = node.property as Node;
        if (node.computed === true && key.type === "Literal" && CANT_TOUCH.has(String(key.value))) problems.add(`${place(node)}: it can't use ${String(key.value)}`);
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
  if (!/export const extension\b/.test(processCode)) problems.push("The process file must have `export const extension: ProcessExtension = {...}`");
  const tests = (testCode.match(/\bit(?:\.each\([^)]*\))?\(/g) ?? []).length;
  if (tests < TESTS_LEAST) problems.push(`The test file has ${tests} tests, and needs at least ${TESTS_LEAST}, checking its behaviour against its source`);
  if (!/simulate\(/.test(testCode)) problems.push("The tests must run the real model with simulate()");
  return problems;
}
