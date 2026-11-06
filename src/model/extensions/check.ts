import { DAY, PROCESS } from "../params";
import { viewOf } from "../processes/processes";
import { ORGANS, ROUTE_IDS } from "../ids";
import { simulate } from "../engine/simulate";
import { Body, Scenario } from "../scenario";
import { SYSTEMS } from "../systems";
import type { ExtensionState, ProcessExtension } from "./api";
import { weighsSomething } from "../words";

const SAY_WORDS_MOST = 25;
const STEP_MIN = 15;
const STOPS = { least: 2, most: 6 };
const CHEAP_MS_PER_CALL = 0.2;
const CALLS_TIMED = 2000;
const NOT_TO_BE_SAID = [
  /\bnot just\b|\brather than\b|\bbut not\b|\bnot only\b/i,
  /you should feel/i,
  /you have (?:a |an )?[a-z ]*(?:disease|disorder|syndrome|cancer|deficiency)/i,
  /\bdiagnos/i,
  /\btake \d/i,
];

const man: Body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 };
const woman: Body = { sex: "female", age: 52, heightCm: 165, weightKg: 70 };
const day = [
  { from: 0, posture: "sleeping" as const },
  { from: 450, posture: "standing" as const },
];
const food = {
  id: "meal",
  label: "Meal",
  at: 780,
  grams: 500,
  waterMl: 280,
  carbsG: 80,
  sugarG: 12,
  fatG: 25,
  proteinG: 30,
  fiberG: 6,
  caffeineMg: 90,
  alcoholG: 0,
};
const cold = {
  id: "cold",
  label: "Cold",
  preset: "illness" as const,
  from: 300,
  until: null,
  intensity: 0.6,
  muscles: [],
  symptoms: ["fever" as const],
  custom: null,
  source: "",
};

// The bodies and days a process has to hold up across.
const SCENARIOS: Scenario[] = [
  { body: man, intakes: [], activities: day, substances: [], events: [] },
  {
    body: woman,
    intakes: [food],
    activities: [...day, { from: 1020, posture: "running" }, { from: 1080, posture: "sitting" }],
    substances: [],
    events: [],
  },
  {
    body: woman,
    intakes: [food],
    activities: day,
    substances: [],
    events: [cold],
    cycle: { start: -10 * 1440, lengthDays: 28, periodDays: 5 },
  },
  {
    body: { ...man, age: 72, weightKg: 110 },
    intakes: [{ ...food, alcoholG: 30 }],
    activities: day,
    substances: [],
    events: [],
  },
];

function checkState(state: ExtensionState, who: string, problem: (text: string) => void) {
  const { stops, headline, here } = state;
  if (typeof headline !== "string" || !headline.trim()) problem(`${who}: the headline is empty`);
  else if (headline.trim().split(/\s+/).length >= PROCESS.sentenceWordsUnder)
    problem(`${who}: the headline "${headline}" must be under ${PROCESS.sentenceWordsUnder} words`);
  if (stops.length < STOPS.least || stops.length > STOPS.most)
    problem(`${who}: it has ${stops.length} stops, and needs ${STOPS.least} to ${STOPS.most}`);
  const ids = new Set(stops.map((stop) => stop.id));
  if (ids.size !== stops.length) problem(`${who}: two stops share an id`);
  if (here !== null && !ids.has(here)) problem(`${who}: here is "${here}", which is no stop's id`);
  if (state.active && here === null) problem(`${who}: it is active, so here must name the stop where the action is`);
  if (!state.active && here !== null) problem(`${who}: it isn't active, so here must be null`);
  for (const stop of stops) {
    const name = `${who}, stop ${stop.id}`;
    if (!Number.isFinite(stop.share) || stop.share < 0 || stop.share > 1)
      problem(`${name}: share is ${stop.share}, and must be 0 to 1`);
    if (!Number.isFinite(stop.flow) || stop.flow < 0 || stop.flow > 1)
      problem(`${name}: flow is ${stop.flow}, and must be 0 to 1`);
    if (!stop.label.trim()) problem(`${name}: the label is empty`);
    if (stop.label.trim().split(/\s+/).length > 2)
      problem(`${name}: the label "${stop.label}" must be one or two words`);
    if (/NaN|undefined|Infinity/.test(`${stop.reading} ${stop.say} ${stop.label} ${headline}`))
      problem(`${name}: its words contain a broken number: "${stop.reading} ${stop.say}"`);
    if (stop.reading.includes("%"))
      problem(
        `${name}: its reading "${stop.reading}" is a percentage. A 0 to 1 scale reads as levelWord from ./api, and a measurement as a number with its unit`,
      );
    if (stop.say.trim().split(/\s+/).length > SAY_WORDS_MOST) problem(`${name}: say is over ${SAY_WORDS_MOST} words`);
    if (weighsSomething(`${stop.say} ${headline}`))
      problem(
        `${name}: its words state an amount: "${stop.say}". Say what is happening, and put the amount in reading`,
      );
    if (stop.organ !== null && !ORGANS.includes(stop.organ)) problem(`${name}: there is no organ "${stop.organ}"`);
    for (const route of stop.routes)
      if (!(ROUTE_IDS as readonly string[]).includes(route)) problem(`${name}: there is no route "${route}"`);
    if (stop.from !== undefined && !ids.has(stop.from))
      problem(`${name}: from is "${stop.from}", which is no stop's id`);
    for (const words of NOT_TO_BE_SAID)
      if (words.test(`${stop.say} ${headline}`)) problem(`${name}: its words can't say this: ${words}`);
  }
}

// Everything the app relies on from a process. Each problem comes back in words that say how to fix it.
export function checkExtension(extension: ProcessExtension, fileName: string): string[] {
  const problems = new Set<string>();
  const problem = (text: string) => problems.add(text);
  if (extension.id !== fileName) problem(`The id "${extension.id}" must match the file name "${fileName}"`);
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(extension.id))
    problem(`The id "${extension.id}" must be lowercase letters and underscores`);
  if (!extension.title.trim() || extension.title.length > 40) problem("The title must be 1 to 40 characters");
  if ((extension.system as string) === "overview" || !SYSTEMS.some((s) => s.id === extension.system))
    problem(`There is no system "${extension.system}" to list it under`);
  if (!["A", "B", "C"].includes(extension.evidence)) problem("Evidence must be A, B or C");
  if (extension.source.trim().length < 10) problem("The source must say where the numbers come from");
  if (!Object.keys(extension.params).length) problem("params must hold its tunable numbers");
  for (const [name, number] of Object.entries(extension.params))
    if (!Number.isFinite(number)) problem(`The param ${name} is not a number`);

  let moves = false;
  let threw = false;
  for (const [s, scenario] of SCENARIOS.entries()) {
    const view = viewOf(simulate(scenario));
    let first: string | null = null;
    for (let t = 0; t <= DAY.minutes; t += STEP_MIN) {
      const who = `In test body ${s + 1} at minute ${t}`;
      let state: ExtensionState;
      try {
        state = extension.at(view, t);
      } catch (e: unknown) {
        problem(`${who}: it threw ${e instanceof Error ? e.message : String(e)}`);
        threw = true;
        continue;
      }
      checkState(state, who, problem);
      if (JSON.stringify(extension.at(view, t)) !== JSON.stringify(state))
        problem(`${who}: two calls gave different answers, and it must be pure`);
      const shape = JSON.stringify(state.stops.map((stop) => [stop.share, stop.reading]));
      if (first === null) first = shape;
      else if (shape !== first) moves = true;
    }
  }
  if (threw) return [...problems];
  if (!moves) problem("Nothing changes across the day. A process has to follow the model's curves or the clock");
  if (
    ![...SCENARIOS].some((scenario) =>
      extension.at(viewOf(simulate(scenario)), 720).stops.some((stop) => stop.routes.length > 0),
    )
  )
    problem("No stop has a route, and a process needs a path through the vessels");

  const view = viewOf(simulate(SCENARIOS[0]));
  const started = performance.now();
  for (let i = 0; i < CALLS_TIMED; i++) extension.at(view, i % DAY.minutes);
  const perCall = (performance.now() - started) / CALLS_TIMED;
  if (perCall > CHEAP_MS_PER_CALL)
    problem(
      `One call takes ${perCall.toFixed(2)} ms, and has to stay under ${CHEAP_MS_PER_CALL} ms because it runs thousands of times`,
    );
  return [...problems];
}
