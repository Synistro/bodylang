import { describe, expect, it } from "vitest";
import { checkShape, checkSource, PROCESS_IMPORTS, testImports } from "./extendCheck";

const check = (code: string) => checkSource(code, PROCESS_IMPORTS).join("\n");

describe("what a new process may touch", () => {
  it("lets through plain code using the contract", () => {
    const code = `import type { ProcessExtension } from "./api";
export const extension: ProcessExtension = { id: "x", title: "X", system: "brain", evidence: "C", source: "A source", params: { a: 1 }, at: (view, t) => ({ active: true, headline: String(view.value("glucose", t)), here: null, stops: [] }) };`;
    expect(check(code)).toBe("");
  });

  it.each([
    ['import { readFileSync } from "node:fs";', /can't import "node:fs"/],
    ['import { getState } from "../../store";', /can't import/],
    ['export { x } from "../simulate";', /can't import/],
    ['const x = await import("./other");', /can't load anything/],
    ['const key = process.env.SECRET;', /can't use process/],
    ['fetch("https://example.com");', /can't use fetch/],
    ["const f = new Function('return 1');", /can't use Function/],
    ['eval("1");', /can't use eval/],
    ["const g = [].constructor.constructor('return this')();", /can't use constructor/],
    ['const g = []["constructor"]["constructor"]("return this")();', /can't use constructor/],
    ['const t = window.location;', /can't use window/],
    ['localStorage.setItem("a", "b");', /can't use localStorage/],
    ['const u = import.meta.url;', /can't use import.meta/],
    ['setTimeout(() => 0, 1);', /can't use setTimeout/],
  ])("rejects %s", (code, message) => {
    expect(check(code)).toMatch(message);
  });

  it("says which line", () => {
    expect(check('const a = 1;\nfetch("x");')).toMatch(/line 2/);
  });

  it("lets a test import the model, and nothing else", () => {
    expect(checkSource('import { it } from "vitest"; import { simulate } from "../simulate"; import { extension } from "./thyroid";', testImports("thyroid"))).toEqual([]);
    expect(checkSource('import { execSync } from "node:child_process";', testImports("thyroid")).join()).toMatch(/can't import/);
  });
});

describe("the shape of what comes back", () => {
  const good = "export const extension: ProcessExtension = {};";
  const tests = 'it("a", () => { simulate(s); }); it("b", () => {}); it("c", () => {});';

  it("passes real tests", () => {
    expect(checkShape(good, tests)).toEqual([]);
  });

  it("wants the export the app looks for", () => {
    expect(checkShape("const extension = {};", tests).join()).toMatch(/export const extension/);
  });

  it("wants several tests, using the real model", () => {
    expect(checkShape(good, 'it("a", () => { simulate(s); });').join()).toMatch(/at least 3/);
    expect(checkShape(good, 'it("a", () => {}); it("b", () => {}); it("c", () => {});').join()).toMatch(/simulate/);
  });
});
