import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Which part of the code may import which. Folders of files that may import each other count as one part.
const MAY_IMPORT: Record<string, readonly string[]> = {
  model: [],
  look: ["model"],
  agent: ["closeup", "look", "model"],
  closeup: ["agent", "model"],
  server: ["agent", "closeup", "model"],
  scene: ["look", "model", "wall"],
  wall: [],
  store: ["agent", "look", "model", "scene"],
  ui: ["agent", "closeup", "look", "model", "scene", "store", "wall"],
  main: ["ui"],
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

describe("the layers", () => {
  it("only import downward", () => {
    expect(wrongImports()).toEqual([]);
  });

  it("know every part of the code", () => {
    const parts = new Set([...sourceFiles("src"), ...sourceFiles("server")].map(partOf));
    expect([...parts].filter((part) => !(part in MAY_IMPORT))).toEqual([]);
  });
});
