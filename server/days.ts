import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DATE_PATTERN, DayDoc, parseDayDoc } from "../src/model/day";

const MAX_DAY_BYTES = 2_000_000;

// Your days stay on this Mac and out of the repository, so nothing that edits the code can touch them.
const daysFolder = () => join(process.env.BODYLANG_DATA ?? join(homedir(), ".bodylang"), "days");

function newestDay(folder: string): DayDoc | null {
  mkdirSync(folder, { recursive: true });
  const names = readdirSync(folder)
    .filter((name) => DATE_PATTERN.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))
    .sort();
  const newest = names.at(-1);
  return newest ? parseDayDoc(JSON.parse(readFileSync(join(folder, newest), "utf8"))) : null;
}

function writeDay(folder: string, doc: DayDoc) {
  mkdirSync(folder, { recursive: true });
  const target = join(folder, `${doc.date}.json`);
  const draft = `${target}.${process.pid}.tmp`;
  // A crash mid-write leaves the last good day in place.
  writeFileSync(draft, `${JSON.stringify(doc, null, 1)}\n`);
  renameSync(draft, target);
}

const putSchema = z.object({ writer: z.string().min(1).max(100), doc: z.unknown() });

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_DAY_BYTES) throw new Error("Day file too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// GET answers with the newest day on disk, whatever its date, because the page carries it forward.
// PUT saves one day and tells every other open page, so the wallpaper follows what you just said.
export async function handleDay(req: IncomingMessage, res: ServerResponse, changed: (writer: string) => void) {
  const folder = daysFolder();
  if (req.method === "GET") {
    const doc = newestDay(folder);
    if (!doc) {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(doc));
    return;
  }
  if (req.method === "PUT") {
    const { writer, doc } = putSchema.parse(await readJson(req));
    writeDay(folder, parseDayDoc(doc));
    changed(writer);
    res.statusCode = 204;
    res.end();
    return;
  }
  res.statusCode = 405;
  res.end();
}
