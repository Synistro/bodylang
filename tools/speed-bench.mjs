#!/usr/bin/env node
// Measures how fast Bodylang answers and whether it still does the right thing, across ways of dividing
// the work between models. Every run costs real money, so it saves each result the moment it arrives,
// picks up where it left off, and stops at its budget.
//
//   node tools/speed-bench.mjs results.jsonl [--budget 12] [--repeats 2] [--plans opus,haiku] [--concurrency 3]
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "vite";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const OUT = args[0];
const BUDGET = Number(flag("budget", 12));
const REPEATS = Number(flag("repeats", 2));
const CONCURRENCY = Number(flag("concurrency", 3));
if (!OUT) throw new Error("Give a results file");

const opus = { model: "claude-opus-5-5", effort: "low" };
const sonnet = { model: "claude-sonnet-5-5", effort: "low" };
const haiku = { model: "claude-haiku-5-5", effort: "low" };
const ALL_PLANS = {
  opus: { act: opus, answer: null },
  sonnet: { act: sonnet, answer: null },
  haiku: { act: haiku, answer: null },
  "haiku+opus": { act: haiku, answer: opus },
  "haiku+sonnet": { act: haiku, answer: sonnet },
};
const PLANS = flag("plans", Object.keys(ALL_PLANS).join(",")).split(",");

const NOW = 14 * 60 + 30;
const pizza = { id: "pizza", label: "Pizza", at: 790, grams: 214, waterMl: 92, carbsG: 71, sugarG: 7.6, fatG: 20.7, proteinG: 24, fiberG: 4.9, caffeineMg: 0, alcoholG: 0, source: { kind: "table", fdcId: 2708615, name: "Pizza, cheese", dataset: "FNDDS" }, serving: { label: "slice", grams: 107 } };
const base = (over = {}) => ({
  body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
  intakes: [],
  activities: [{ from: -1440, posture: "sleeping" }, { from: -990, posture: "standing" }, { from: -30, posture: "sleeping" }, { from: 450, posture: "standing" }],
  substances: [],
  events: [],
  cycle: null,
  now: NOW,
  system: "overview",
  process: null,
  focus: null,
  focusMuscle: null,
  whatIf: null,
  assumptions: {},
  ...over,
});

const logged = (actions) => actions.filter((a) => /^(log_|set_|define_|correct_|remove_|end_)/.test(a.name));
const near = (x, want, within) => Math.abs(x - want) <= within;

// Each sentence, and what doing the right thing means for it, as a check code can run.
const SENTENCES = [
  { id: "lunch", text: "two slices of pizza and a coke at 13:10", check: (a) => {
    const foods = a.filter((x) => x.name === "log_intake");
    const za = foods.find((x) => /pizza/i.test(x.args.label));
    const coke = foods.find((x) => /coke|cola/i.test(x.args.label));
    if (!za || !coke) return "missing a food";
    if (za.args.at !== 790 || coke.args.at !== 790) return "wrong time";
    if (za.args.source?.kind !== "table") return "pizza not from the table";
    if (coke.args.source?.kind !== "table") return "coke not from the table";
    if (za.args.grams < 120 || za.args.grams > 400) return `pizza ${za.args.grams} g`;
    return null;
  } },
  { id: "coffee", text: "I just had a flat white and a banana", check: (a) => {
    const foods = a.filter((x) => x.name === "log_intake");
    if (foods.length !== 2) return `${foods.length} foods`;
    if (foods.some((x) => !near(x.args.at, NOW, 10))) return "wrong time";
    if (!foods.some((x) => x.args.caffeine_mg >= 40)) return "no caffeine";
    if (!foods.some((x) => /banana/i.test(x.args.label) && x.args.carbs_g > 15)) return "banana wrong";
    return null;
  } },
  { id: "gym", text: "chest and triceps at the gym this morning from 7 to 8, pretty hard", check: (a) => {
    const e = a.find((x) => x.name === "log_event");
    if (!e || e.args.preset !== "training") return "no training";
    const groups = e.args.muscles.map((m) => m.group);
    if (!groups.includes("chest") || !groups.includes("triceps")) return `muscles ${groups}`;
    if (e.args.from !== 420 || e.args.until !== 480) return `times ${e.args.from}-${e.args.until}`;
    if (e.args.intensity < 0.6) return `intensity ${e.args.intensity}`;
    return null;
  } },
  { id: "cold", text: "I think I'm coming down with a cold, sore throat and a bit of a fever", check: (a) => {
    const e = a.find((x) => x.name === "log_event");
    if (!e || e.args.preset !== "illness") return "no illness";
    if (e.args.until !== null) return "ended";
    if (!e.args.symptoms.includes("fever")) return "no fever";
    return null;
  } },
  { id: "night", text: "slept only 4 hours last night, went to bed at 3", check: (a) => {
    const s = a.find((x) => x.name === "set_sleep");
    if (!s) return "no set_sleep";
    if (!near(s.args.bed, 180, 5) || !near(s.args.wake, 420, 15)) return `${s.args.bed}-${s.args.wake}`;
    return null;
  } },
  { id: "sauna", text: "just got out of the sauna, was in there for 20 minutes", check: (a) => {
    const e = a.find((x) => x.name === "log_event");
    if (!e || e.args.preset !== "custom") return "no custom event";
    if (!near(e.args.until - e.args.from, 20, 5)) return "wrong length";
    if (!e.args.custom.effects.some((x) => x.channel === "temperature" || x.channel === "heartRate")) return "no effect";
    return null;
  } },
  { id: "drug", text: "took 400 mg ibuprofen an hour ago", check: (a) => {
    const s = a.find((x) => x.name === "define_substance");
    if (!s) return "no substance";
    if (s.args.dose_mg !== 400 || !near(s.args.at, NOW - 60, 5)) return "wrong dose or time";
    if (!s.args.source) return "no source";
    return null;
  } },
  { id: "correction", text: "actually the pizza was only one slice", state: base({ intakes: [pizza], assumptions: { pizza: "Two slices" } }), check: (a) => {
    const c = a.find((x) => x.name === "correct_intake");
    const again = a.find((x) => x.name === "log_intake");
    if (again && !c) return near(again.args.grams, 107, 25) && again.args.id === "pizza" ? null : "logged a second one";
    if (!c || c.args.id !== "pizza") return "no correction";
    return near(c.args.grams, 107, 25) ? null : `${c.args.grams} g`;
  } },
  { id: "emergency", text: "crushing pain in my chest and my left arm has gone numb", check: (a, reply) => {
    if (logged(a).length) return "logged something";
    return /emergency|911|999|112|ambulance|medical help|call/i.test(reply) ? null : "didn't send for help";
  } },
  { id: "question", text: "what's happening in my stomach right now", state: base({ intakes: [pizza], assumptions: { pizza: "Two slices" } }), check: (a, reply) => {
    if (logged(a).length) return "logged something";
    return /\d/.test(reply) ? null : "no number";
  } },
];

const done = new Set();
let spent = 0;
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line);
    done.add(`${row.plan}/${row.sentence}/${row.repeat}`);
    spent += row.costUsd ?? 0;
  }
}

const jobs = PLANS.flatMap((plan) => SENTENCES.flatMap((sentence) => Array.from({ length: REPEATS }, (_, repeat) => ({ plan, sentence, repeat })))).filter((j) => !done.has(`${j.plan}/${j.sentence.id}/${j.repeat}`));
console.log(`${jobs.length} runs to do, $${spent.toFixed(2)} spent so far, stopping at $${BUDGET}`);

const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
const { runTell } = await vite.ssrLoadModule("/server/agent.ts");

async function runOne({ plan, sentence, repeat }) {
  const actions = [];
  let reply = "";
  let unverified = [];
  const measure = await runTell(
    { text: sentence.text, state: sentence.state ?? base(), mode: "tell", history: [], date: "2026-11-05" },
    ALL_PLANS[plan],
    (event) => {
      if (event.type === "action") actions.push({ name: event.name, args: event.args });
      if (event.type === "reply") {
        reply = event.lines.map((l) => l.text).join(" ");
        unverified = event.lines.flatMap((l) => l.unverified ?? []);
      }
    },
    new AbortController(),
    () => undefined,
  );
  let problem;
  try {
    problem = sentence.check(actions, reply);
  } catch (e) {
    problem = `check threw: ${e.message}`;
  }
  if (!reply) problem = problem ?? "no reply";
  return { plan, sentence: sentence.id, repeat, ...measure, ok: problem === null, problem, reply, unverified, tools: actions.map((a) => a.name) };
}

let next = 0;
let failures = 0;
async function worker() {
  while (next < jobs.length && spent < BUDGET && failures < 12) {
    const job = jobs[next++];
    try {
      const row = await runOne(job);
      spent += row.costUsd;
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      console.log(`${next}/${jobs.length} ${row.plan} ${row.sentence}: ${row.totalMs} ms ${row.ok ? "ok" : `WRONG (${row.problem})`} $${spent.toFixed(2)}`);
    } catch (e) {
      failures++;
      console.log(`${job.plan} ${job.sentence.id}: failed: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await vite.close();
if (spent >= BUDGET) console.log(`Stopped at the budget, $${spent.toFixed(2)}`);
process.exit(0);
