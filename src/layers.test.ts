import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Which part of the code may import which, counting type imports. A part is a folder or a single file in src.
const MAY_IMPORT: Record<string, readonly string[]> = {
  model: [],
  look: ["model"],
  closeup: ["model"],
  actions: ["closeup", "model"],
  wall: [],
  scene: ["look", "model", "wall"],
  wire: [],
  store: ["actions", "look", "model", "wire"],
  ui: ["actions", "closeup", "look", "model", "scene", "store", "wall", "wire"],
  main: ["ui"],
  server: ["actions", "closeup", "model", "wire"],
};

const partOf = (path: string) => {
  const [top, next] = path.split("/");
  if (top === "server") return "server";
  return next.replace(/\.tsx?$/, "");
};

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function wrongImports() {
  const root = process.cwd();
  const wrong: string[] = [];
  for (const file of [...sourceFiles("src"), ...sourceFiles("server")]) {
    const from = partOf(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = match[1] ?? match[2];
      if (!spec.startsWith(".")) continue;
      const target = relative(root, resolve(dirname(file), spec));
      if (!target.startsWith("src/") && !target.startsWith("server/")) continue;
      const to = partOf(target);
      if (to !== from && !(MAY_IMPORT[from] ?? []).includes(to)) wrong.push(`${file} imports ${spec}: ${from} may not import ${to}`);
    }
  }
  return wrong;
}

function importCycles() {
  const root = process.cwd();
  const files = [...sourceFiles("src"), ...sourceFiles("server")];
  const known = new Set(files);
  const importsOf = (file: string) =>
    [...readFileSync(file, "utf8").matchAll(IMPORT)]
      .map((match) => match[1] ?? match[2])
      .filter((spec) => spec.startsWith("."))
      .flatMap((spec) => {
        const target = relative(root, resolve(dirname(file), spec));
        return [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`].filter((path) => known.has(path));
      });
  const finished = new Set<string>();
  const found: string[] = [];
  const visit = (file: string, path: string[]) => {
    if (path.includes(file)) {
      found.push([...path.slice(path.indexOf(file)), file].join(" -> "));
      return;
    }
    if (finished.has(file)) return;
    for (const next of importsOf(file)) visit(next, [...path, file]);
    finished.add(file);
  };
  for (const file of files) visit(file, []);
  return found;
}

describe("the layers", () => {
  it("only import downward", () => {
    expect(wrongImports()).toEqual([]);
  });

  it("have no import cycles, counting type imports", () => {
    expect(importCycles()).toEqual([]);
  });

  it("know every part of the code", () => {
    const parts = new Set([...sourceFiles("src"), ...sourceFiles("server")].map(partOf));
    expect([...parts].filter((part) => !(part in MAY_IMPORT))).toEqual([]);
  });
});
