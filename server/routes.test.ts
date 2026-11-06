import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { BadRequest, readJson } from "./http";
import { handleApi } from "./routes";

const JSON_HEADERS = { host: "localhost:5183", "content-type": "application/json" };
const notify = { buildChanged: () => undefined, dayChanged: () => undefined };

function request(url: string, method: string, headers: Record<string, string> = JSON_HEADERS, body = "{}") {
  return Object.assign(Readable.from([Buffer.from(body)]), { url, method, headers }) as unknown as IncomingMessage;
}

function response() {
  const res = { statusCode: 200, headersSent: false, body: "", end: (text = "") => void (res.body = text) };
  return res as typeof res & ServerResponse;
}

const called = vi.fn();
const routes = {
  "/echo": { methods: ["POST"], load: async () => called },
  "/broken": { methods: ["POST"], load: async () => () => Promise.reject(new Error("boom")) },
  "/bad": { methods: ["POST"], load: async () => () => Promise.reject(new BadRequest("nope")) },
};

describe("what loads a server file by its path", () => {
  it("names files that exist, which no compiler checks in a string", () => {
    const loaded = ["vite.config.ts", "tools/speed-bench.mjs"].flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/ssrLoadModule\(\s*"\/([^"]+)"/g)].map((match) => match[1]),
    );
    expect(loaded).toEqual(expect.arrayContaining(["server/routes.ts", "server/tell.ts"]));
    expect(loaded.filter((path) => !existsSync(path))).toEqual([]);
  });

  it("still offers the bench what it takes from the module", async () => {
    expect((await import("./tell")).runTell).toBeTypeOf("function");
  });
});

describe("the API routes", () => {
  it("runs a route that is asked for properly", async () => {
    const res = response();
    await handleApi(request("/echo?x=1", "POST"), res, notify, routes);
    expect(called).toHaveBeenCalledTimes(1);
  });

  it("answers what isn't there, and the wrong method", async () => {
    const missing = response();
    await handleApi(request("/nothing", "POST"), missing, notify, routes);
    expect(missing.statusCode).toBe(404);
    const wrong = response();
    await handleApi(request("/echo", "PUT"), wrong, notify, routes);
    expect(wrong.statusCode).toBe(405);
  });

  it("turns away a request from another site before anything runs", async () => {
    called.mockClear();
    const res = response();
    await handleApi(request("/echo", "POST", { ...JSON_HEADERS, origin: "https://example.com" }), res, notify, routes);
    expect(res.statusCode).toBe(403);
    expect(called).not.toHaveBeenCalled();
  });

  it("says what failed, as the client's fault or its own", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = response();
    await handleApi(request("/bad", "POST"), bad, notify, routes);
    expect(bad).toMatchObject({ statusCode: 400, body: "nope" });
    const broken = response();
    await handleApi(request("/broken", "POST"), broken, notify, routes);
    expect(broken).toMatchObject({ statusCode: 500, body: "boom" });
    quiet.mockRestore();
  });

  it("knows every route the page calls", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync("server/routes.ts", "utf8"));
    for (const path of ["/tell", "/day", "/extend", "/explain", "/name-question", "/beacon"]) expect(source).toContain(`"${path}"`);
  });
});

describe("reading a request", () => {
  it("refuses too much, and what isn't JSON", async () => {
    await expect(readJson(request("/", "POST", JSON_HEADERS, "x".repeat(50)), 10)).rejects.toThrow(/too large/);
    await expect(readJson(request("/", "POST", JSON_HEADERS, "not json"), 100)).rejects.toThrow(/isn't JSON/);
  });
});
