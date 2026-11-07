#!/usr/bin/env node
// Asks Claude a film's questions once, on the test server, and keeps exactly what came back, so a film replays real
// answers. Every question costs money, so one that is already saved is never asked again. Delete its file to ask again.
//
//   node demo/record.mjs ask [http://localhost:5199]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const film = process.argv[2];
if (!film) throw new Error("Which film? Such as ask");
const url = process.argv[3] ?? "http://localhost:5199";
const folder = join(here, film);
const questions = JSON.parse(readFileSync(join(folder, "questions.json"), "utf8"));
const state = JSON.parse(readFileSync(join(folder, "state.json"), "utf8"));
const saved = join(folder, "recordings");
mkdirSync(saved, { recursive: true });

async function record({ id, depth, text, body }) {
  const path = join(saved, `${id}.json`);
  if (existsSync(path)) return console.log(`${id}: already saved`);
  const asked = Date.now();
  const response = await fetch(`${url}/api/tell`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      state: body ? { ...state, day: { ...state.day, body } } : state,
      mode: "ask",
      depth,
      history: [],
      date: null,
    }),
  });
  if (!response.ok) throw new Error(`${id}: the server answered ${response.status}: ${await response.text()}`);
  const events = [];
  let first = null;
  let buffer = "";
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (!line.startsWith("data: ")) continue;
      first ??= Date.now();
      events.push({ ms: Date.now() - first + 1, event: JSON.parse(line.slice(6)) });
    }
  }
  const problem = events.find(({ event }) => event.type === "error");
  if (problem) throw new Error(`${id}: ${problem.event.message}`);
  writeFileSync(path, `${JSON.stringify({ text, depth, body, events })}\n`);
  console.log(`${id}: saved after ${Math.round((Date.now() - asked) / 1000)} s`);
}

const queue = [...questions];
const failures = [];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const question = queue.shift();
      await record(question).catch((error) => failures.push(error.message));
    }
  }),
);
if (failures.length) {
  console.error(`Failed:\n${failures.join("\n")}`);
  process.exit(1);
}
