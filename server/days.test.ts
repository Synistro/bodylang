import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleDay } from "./days";
import type { Notify } from "./http";

const dayOn = (date: string) => ({ version: 1, date, body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 }, intakes: [], activities: [{ from: 0, posture: "sleeping" }], substances: [], events: [], cycle: null, assumptions: {} });

function request(method: string, body?: unknown) {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, headers: {} }) as unknown as IncomingMessage;
}

function response() {
  const res = { statusCode: 200, body: "", headers: {} as Record<string, string>, setHeader: (k: string, v: string) => void (res.headers[k] = v), end: (text = "") => void (res.body = text) };
  return res as typeof res & ServerResponse;
}

const silent: Notify = { buildChanged: () => undefined, dayChanged: () => undefined };

describe("the day files", () => {
  let data: string;
  const before = process.env.BODYLANG_DATA;

  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), "bodylang-days-"));
    process.env.BODYLANG_DATA = data;
  });

  afterEach(() => {
    process.env.BODYLANG_DATA = before;
    rmSync(data, { recursive: true, force: true });
  });

  const put = (doc: unknown, notify = silent) => handleDay(request("PUT", { writer: "page", doc }), response(), notify);

  it("reads nothing before anything is saved", async () => {
    const res = response();
    await handleDay(request("GET"), res, silent);
    expect(res.statusCode).toBe(204);
  });

  it("saves one file per date and reads back the newest", async () => {
    await put(dayOn("2026-11-05"));
    await put(dayOn("2026-11-06"));
    expect(readdirSync(join(data, "days")).sort()).toEqual(["2026-11-05.json", "2026-11-06.json"]);
    const res = response();
    await handleDay(request("GET"), res, silent);
    expect(JSON.parse(res.body).date).toBe("2026-11-06");
  });

  it("tells other pages who saved", async () => {
    const writers: string[] = [];
    await put(dayOn("2026-11-06"), { ...silent, dayChanged: (writer) => void writers.push(writer) });
    expect(writers).toEqual(["page"]);
  });

  it("refuses a day that isn't one, and leaves the last good file alone", async () => {
    await put(dayOn("2026-11-06"));
    const good = readFileSync(join(data, "days/2026-11-06.json"), "utf8");
    await expect(put({ ...dayOn("2026-11-06"), intakes: "nonsense" })).rejects.toThrow();
    expect(readFileSync(join(data, "days/2026-11-06.json"), "utf8")).toBe(good);
  });

  it("can't be talked into writing outside the folder", async () => {
    await expect(put(dayOn("../../escape"))).rejects.toThrow();
    expect(readdirSync(data)).not.toContain("escape.json");
  });

  it("ignores files that aren't days", async () => {
    mkdirSync(join(data, "days"), { recursive: true });
    writeFileSync(join(data, "days/notes.json"), "{}");
    const res = response();
    await handleDay(request("GET"), res, silent);
    expect(res.statusCode).toBe(204);
  });
});
