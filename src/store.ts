import { useSyncExternalStore } from "react";
import { Action, BodyState, GuideStep, reduce, traceLine } from "./agent/actions";
import { DayDoc } from "./model/day";
import { CAFFEINE, LANES } from "./model/params";
import type { MuscleGroup } from "./model/muscleGroups";
import { ReplyLine } from "./model/narrate";
import { followProcess, Process, processesAt } from "./model/processes";
import { Scenario, simulate, Trajectory } from "./model/simulate";
import type { Theme } from "./scene/stage";

export interface Exchange {
  id: number;
  text: string;
  trace: string[];
  reply: ReplyLine[];
  answer: string;
  status: "working" | "done" | "error";
  error?: string;
  scripted: boolean; // the opening scene: it sets the body up and has nothing to say
  session: number | null; // the Ask session this belongs to, which ends with it
  name: string | null; // a few words for a long question, once Haiku has come up with them
}

export type Mode = "tell" | "ask";
export type Depth = "simple" | "deep";

// While you are asking, the screen shows a copy of your day that Claude is free to change. Your real
// day sits here untouched, and leaving puts exactly these same objects back.
export interface Asking {
  id: number;
  real: BodyState;
  realDerived: Derived;
  realT: number;
  history: { asked: string; answered: string }[];
  guide: GuideStep[] | null;
  step: number;
  guideOpen: boolean;
  moment: number | null; // a minute the day chart can't reach, shown by the current step until you move the chart
  cancel: (() => void) | null; // stops an answer still on its way
}

export interface Ui {
  t: number;
  playing: boolean;
  playUntil: number; // the last moment on the day chart when play was pressed
  theme: Theme;
  layers: { skin: boolean; vessels: boolean };
  hover: string | null;
  hoverLane: string | null;
  hoverMuscle: MuscleGroup | null;
  exchanges: Exchange[];
  bodyOpen: boolean;
  // Which numbered stop of the selected process is in the spotlight, during a walkthrough or a hover.
  stop: number | null;
  touring: boolean;
  mode: Mode;
  depth: Depth;
  asking: Asking | null;
  date: string | null; // the day being saved; null when nothing is, as in the demo
  dayProblem: string | null; // why your day could not be read or saved
  fixing: Fixing | null;
  build: Build | null;
  explaining: Explaining | null;
}

// Words selected on screen, what surrounds them, and where they are, for the panel that explains them.
export interface Explaining {
  term: string;
  around: string;
  page: string;
  top: number;
  bottom: number;
  center: number;
}

// A process a separate Claude session is adding, or has just finished with.
export interface Build {
  id: string;
  title: string;
  stage: "writing" | "testing" | "final" | "ready" | "failed" | "stopped";
  message: string | null;
}

// The foods open for correcting, and where on the chart they were clicked.
export interface Fixing {
  ids: string[];
  x: number;
}

export interface Derived {
  trajectory: Trajectory;
  fastClearer: Trajectory;
  slowClearer: Trajectory;
  whatIf: Trajectory | null;
}

export interface AppState extends Ui, Derived {
  body: BodyState;
}

const START = {
  body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
  activities: [
    { from: 0, posture: "sleeping" },
    { from: 450, posture: "standing" },
  ],
} satisfies Pick<Scenario, "body" | "activities">;

const initialBody: BodyState = {
  ...START,
  intakes: [],
  substances: [],
  events: [],
  cycle: null,
  now: 12 * 60,
  system: "overview",
  process: null,
  focus: null,
  focusMuscle: null,
  whatIf: null,
  assumptions: {},
};

function derive(b: BodyState): Derived {
  const scenario: Scenario = { body: b.body, intakes: b.intakes, activities: b.activities, substances: b.substances, events: b.events, cycle: b.cycle };
  return {
    trajectory: simulate(scenario),
    fastClearer: simulate({ ...scenario, caffeineHalfLifeH: CAFFEINE.halfLifeH.low, sensitivityScale: 1.3 }),
    slowClearer: simulate({ ...scenario, caffeineHalfLifeH: CAFFEINE.halfLifeH.high, sensitivityScale: 0.72 }),
    whatIf: b.whatIf ? simulate({ ...scenario, activities: b.whatIf.activities }) : null,
  };
}

let state: AppState = {
  body: initialBody,
  ...derive(initialBody),
  t: initialBody.now,
  playing: false,
  playUntil: LANES.to,
  theme: "xray",
  layers: { skin: true, vessels: true },
  hover: null,
  hoverLane: null,
  hoverMuscle: null,
  exchanges: [],
  bodyOpen: false,
  stop: null,
  touring: false,
  mode: "tell",
  depth: "simple",
  asking: null,
  date: null,
  dayProblem: null,
  fixing: null,
  build: null,
  explaining: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const getState = () => state;

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUi(patch: Partial<Ui>) {
  state = { ...state, ...patch };
  emit();
}

function setBodyState(next: BodyState, extra: Partial<Ui> = {}) {
  const physiologyChanged =
    next.body !== state.body.body || next.intakes !== state.body.intakes || next.activities !== state.body.activities || next.substances !== state.body.substances || next.events !== state.body.events || next.cycle !== state.body.cycle || next.whatIf !== state.body.whatIf;
  const derived = physiologyChanged ? derive(next) : null;
  const trajectory = derived?.trajectory ?? state.trajectory;
  const process = next.process === null ? null : followProcess(trajectory, next.process, Math.round(state.t));
  const walkthrough = process === next.process ? {} : { stop: null, touring: false };
  state = { ...state, body: { ...next, process }, ...derived, ...walkthrough, ...extra };
  emit();
}

export function dispatch(action: Action, exchangeId?: number) {
  const next = reduce(state.body, action);
  const extra: Partial<Ui> = {};
  if (action.name === "guide" && state.asking) {
    setBodyState(viewOfStep(next, action.args.steps[0]), { asking: { ...state.asking, guide: action.args.steps, step: 0, guideOpen: true, moment: momentOfStep(action.args.steps[0]) }, stop: null, touring: false });
    return;
  }
  // Moving "now" brings the view with it; a viewer who scrubbed elsewhere gets pulled back.
  if (action.name === "set_now") extra.t = action.args.at;
  if (exchangeId !== undefined) {
    extra.exchanges = state.exchanges.map((e) => (e.id === exchangeId ? { ...e, trace: [...e.trace, traceLine(action)] } : e));
  }
  setBodyState(next, extra);
}

export function setBody(patch: Partial<BodyState["body"]>) {
  setBodyState({ ...state.body, body: { ...state.body.body, ...patch } });
}

export function setPostureNow(posture: BodyState["activities"][number]["posture"]) {
  dispatch({ name: "set_activity", args: { posture, from: Math.round(state.body.now) } });
}

export const isOnChart = (minute: number) => minute >= LANES.from && minute <= LANES.to;

const momentOfStep = (step: GuideStep) => (step.at !== null && !isOnChart(step.at) ? step.at : null);

function viewOfStep(body: BodyState, step: GuideStep): BodyState {
  return {
    ...body,
    system: step.system ?? body.system,
    process: step.process,
    focus: step.organ,
    focusMuscle: step.organ === "muscle" ? step.muscle : null,
  };
}

let nextAskId = 1;

// From here on, everything that changes the body changes the copy.
export function enterAsk() {
  if (state.asking) return state.asking.id;
  const { trajectory, fastClearer, slowClearer, whatIf } = state;
  const id = nextAskId++;
  state = {
    ...state,
    body: { ...state.body, whatIf: null },
    whatIf: null,
    asking: { id, real: state.body, realDerived: { trajectory, fastClearer, slowClearer, whatIf }, realT: state.t, history: [], guide: null, step: 0, guideOpen: false, moment: null, cancel: null },
  };
  emit();
  return id;
}

// Puts your real day back exactly as it was, with the same objects, and drops the copy.
export function leaveAsk() {
  const asking = state.asking;
  if (!asking) return;
  asking.cancel?.();
  state = { ...state, body: asking.real, ...asking.realDerived, t: asking.realT, asking: null, playing: false, stop: null, touring: false, hover: null, hoverMuscle: null, hoverLane: null, fixing: null };
  emit();
}

// Your day as a file. Nothing about what is on screen goes in, and neither does a copy being explored.
export function dayDocOf(s: AppState): DayDoc | null {
  if (!s.date || s.asking) return null;
  const { body, intakes, activities, substances, events, cycle, assumptions } = s.body;
  return { version: 1, date: s.date, body, intakes, activities, substances, events, cycle, assumptions };
}

// Puts a saved day in place, keeping whatever view you are on.
export function restoreDay(doc: DayDoc, minute: number) {
  const atNow = Math.abs(state.t - state.body.now) < 1;
  setBodyState(
    { ...state.body, body: doc.body, intakes: doc.intakes, activities: doc.activities, substances: doc.substances, events: doc.events, cycle: doc.cycle, assumptions: doc.assumptions, whatIf: null, now: minute },
    { date: doc.date, dayProblem: null, ...(atNow ? { t: minute } : {}) },
  );
}

// The clock moved on. A view resting on now moves with it, and one you scrubbed away stays put.
export function setClock(minute: number) {
  if (minute === state.body.now) return;
  const atNow = !state.playing && Math.abs(state.t - state.body.now) < 1;
  setBodyState({ ...state.body, now: minute }, atNow ? { t: minute } : {});
}

export function setMode(mode: Mode) {
  if (mode === "tell") leaveAsk();
  setUi({ mode });
}

const openMoment = (s: AppState) => (s.asking?.guideOpen ? s.asking.moment : null);

// A muscle's story runs for days and the day chart only reaches one, so a step can show a minute off the
// chart. The muscle's close-up and its colour on the body read this, and everything else reads the chart.
export const muscleMinute = (s: AppState) => openMoment(s) ?? s.t;

export const chartOffsetHours = (s: AppState) => {
  const moment = openMoment(s);
  return moment === null ? null : Math.round((moment - s.t) / 60);
};

// Touching the chart means you want to see the chart's time.
export function releaseMoment() {
  if (openMoment(state) === null || !state.asking) return;
  state = { ...state, asking: { ...state.asking, moment: null } };
  emit();
}

// What the current walkthrough step points at in the close-up beside the body.
export const closeupOnScreen = (s: AppState) => (s.asking?.guideOpen && !s.touring ? (s.asking.guide?.[s.asking.step]?.closeup ?? null) : null);

export function goToStep(index: number) {
  const asking = state.asking;
  const step = asking?.guide?.[index];
  if (!asking || !step) return;
  setBodyState(viewOfStep(state.body, step), { asking: { ...asking, step: index, guideOpen: true, moment: momentOfStep(step) }, stop: null, touring: false, playing: false });
}

export function closeGuide() {
  if (state.asking) setUi({ asking: { ...state.asking, guideOpen: false } });
}

export function rememberAsked(asked: string, answered: string) {
  if (state.asking) setUi({ asking: { ...state.asking, history: [...state.asking.history, { asked, answered }] } });
}

export function setAskCancel(cancel: (() => void) | null) {
  if (state.asking) state = { ...state, asking: { ...state.asking, cancel } };
}

export function applyWhatIf() {
  if (!state.body.whatIf) return;
  setBodyState({ ...state.body, activities: state.body.whatIf.activities, whatIf: null });
}

export function clearWhatIf() {
  setBodyState({ ...state.body, whatIf: null });
}

let nextExchangeId = 1;

export function beginExchange(text: string, scripted = false) {
  const exchange: Exchange = { id: nextExchangeId++, text, trace: [], reply: [], answer: "", status: "working", scripted, session: state.asking?.id ?? null, name: null };
  setUi({ exchanges: [...state.exchanges, exchange] });
  return exchange.id;
}

export function updateExchange(id: number, patch: Partial<Exchange>) {
  setUi({ exchanges: state.exchanges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
}

let processCache: { tr: Trajectory; minute: number; list: Process[] } | null = null;

// Processes change with the minute, and the scene asks for them every frame.
export function currentProcesses(s: AppState): Process[] {
  const minute = Math.round(s.t);
  if (!processCache || processCache.tr !== s.trajectory || processCache.minute !== minute) {
    processCache = { tr: s.trajectory, minute, list: processesAt(s.trajectory, minute) };
  }
  return processCache.list;
}

export function selectedProcess(s: AppState): Process | null {
  return s.body.process ? currentProcesses(s).find((p) => p.id === s.body.process) ?? null : null;
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
