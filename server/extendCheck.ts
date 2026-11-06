import { parseAst } from "vite";

// A new process is code that runs in your browser and on your Mac, so before anything runs it, this reads
// it and rejects anything that reaches past the contract: other files, the network, storage, or the page.
// This catches honest mistakes and is no sandbox. A property name held in a variable still gets through, and
// real containment would need a container. It only ever reads code that Claude wrote for your own request.
const CANT_TOUCH = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "eval", "Function", "require", "process", "globalThis", "window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator", "self", "importScripts", "Deno", "Bun", "global", "__dirname", "__filename", "constructor", "__proto__", "prototype", "Reflect", "Proxy", "setTimeout", "setInterval", "queueMicrotask", "Worker", "Image", "Audio", "location", "top", "parent", "opener", "frames", "postMessage", "vi"]);
const FROM_VITEST = new Set(["it", "expect", "describe"]);

export const PROCESS_IMPORTS = ["./api"];
// What a test of a new process needs to run the real model. Paths are from src/model/extensions.
const MODEL_FOR_TESTS = ["../simulate", "../scenario", "../engine/trajectory", "../params", "../cycle", "../processes"];
export const testImports = (id: string) => ["vitest", "./api", "./check", `./${id}`, ...MODEL_FOR_TESTS];

interface Node {
  type: string;
  start?: number;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as Node).type === "string";

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
        if (typeof from === "string" && !allowedImports.includes(from)) problems.add(`${place(node)}: it can't import "${from}". It can import only ${allowedImports.join(", ")}`);
        if (from === "vitest" && node.type === "ImportDeclaration") {
          for (const specifier of node.specifiers as Node[]) {
            const name = (specifier.imported as { name?: string } | undefined)?.name;
            if (!name || !FROM_VITEST.has(name)) problems.add(`${place(node)}: from vitest it can import only ${[...FROM_VITEST].join(", ")}`);
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
        if (key.type === "Literal" && CANT_TOUCH.has(String(key.value))) problems.add(`${place(node)}: it can't use ${String(key.value)}`);
        else if (key.type !== "Literal" && buildsAString(key)) problems.add(`${place(node)}: it can't work out a property name from strings`);
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
