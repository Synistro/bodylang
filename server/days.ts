import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATE_PATTERN, DayDoc, parseDayDoc } from "../src/model/day";
import { dayPutSchema } from "../src/wire";
import { readJson } from "./http";
import type { Notify } from "./http";

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

// GET answers with the newest day on disk, whatever its date, because the page carries it forward.
// PUT saves one day and tells every other open page, so the wallpaper follows what you just said.
export async function handleDay(req: IncomingMessage, res: ServerResponse, { dayChanged }: Notify) {
  const folder = daysFolder();
  if (req.method === "PUT") {
    const { writer, doc } = dayPutSchema.parse(await readJson(req, MAX_DAY_BYTES));
    writeDay(folder, parseDayDoc(doc));
    dayChanged(writer);
    res.statusCode = 204;
    res.end();
    return;
  }
  const doc = newestDay(folder);
  if (!doc) {
    res.statusCode = 204;
    res.end();
    return;
  }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(doc));
}
