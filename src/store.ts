import { useSyncExternalStore } from "react";
import { Action, GuideStep } from "./actions/schemas";
import { BodyState, reduce } from "./actions/reduce";
import { traceLine } from "./actions/trace";
import { ORGAN_HOME, systemById } from "./model/systems";
import { DayDoc } from "./model/day";
import { LANES } from "./model/params";
import type { MuscleGroup } from "./model/muscleGroups";
import { ReplyLine } from "./model/readout";
import { followProcess, processesAt } from "./model/processes/processes";
import { Process } from "./model/processes/line";
import { simulate } from "./model/engine/simulate";
import type { Body, Posture } from "./model/scenario";
import { Trajectory } from "./model/engine/trajectory";
import type { Theme } from "./look";
import type { BuildStatus } from "./wire";

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
  dayMoment: number | null; // a minute outside today that you moved a muscle's recovery to
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
  build: BuildStatus | null; // a process a separate Claude session is adding, or has just finished with
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

// The foods open for correcting, and where on the chart they were clicked.
export interface Fixing {
  ids: string[];
  x: number;
}

export interface Derived {
  trajectory: Trajectory;
  whatIf: Trajectory | null;
}

export interface AppState extends Ui, Derived, BodyState {}

const initialBody: BodyState = {
  day: {
    body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
    activities: [
      { from: 0, posture: "sleeping" },
      { from: 450, posture: "standing" },
    ],
    intakes: [],
    substances: [],
    events: [],
    cycle: null,
    assumptions: {},
  },
  now: 12 * 60,
  view: { system: "overview", process: null, focus: null, focusMuscle: null, whatIf: null },
};

function derive({ day, view }: BodyState): Derived {
  return {
    trajectory: simulate(day),
    whatIf: view.whatIf ? simulate({ ...day, activities: view.whatIf.activities }) : null,
  };
}

let state: AppState = {
  ...initialBody,
  ...derive(initialBody),
  t: initialBody.now,
  playing: false,
  playUntil: LANES.to,
  dayMoment: null,
  theme: "dark",
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

// What a turn and a reducer work on, without what the store derived from it.
export const bodyOf = ({ day, now, view }: BodyState): BodyState => ({ day, now, view });

function setBodyState(next: BodyState, extra: Partial<Ui> = {}) {
  const derived = next.day !== state.day || next.view.whatIf !== state.view.whatIf ? derive(next) : null;
  const trajectory = derived?.trajectory ?? state.trajectory;
  const process = next.view.process === null ? null : followProcess(trajectory, next.view.process, Math.round(state.t));
  const walkthrough = process === next.view.process ? {} : { stop: null, touring: false };
  state = {
    ...state,
    day: next.day,
    now: next.now,
    view: { ...next.view, process },
    ...derived,
    ...walkthrough,
    ...extra,
  };
  emit();
}

export function dispatch(action: Action, exchangeId?: number) {
  const next = reduce(bodyOf(state), action);
  const extra: Partial<Ui> = {};
  if (action.name === "guide" && state.asking) {
    setBodyState(viewOfStep(next, action.args.steps[0]), {
      asking: {
        ...state.asking,
        guide: action.args.steps,
        step: 0,
        guideOpen: true,
        moment: momentOfStep(action.args.steps, 0),
      },
      stop: null,
      touring: false,
    });
    return;
  }
  // Moving "now" brings the view with it; a viewer who scrubbed elsewhere gets pulled back.
  if (action.name === "set_now") extra.t = action.args.at;
  if (exchangeId !== undefined) {
    extra.exchanges = state.exchanges.map((e) =>
      e.id === exchangeId ? { ...e, trace: [...e.trace, traceLine(action)] } : e,
    );
  }
  setBodyState(next, extra);
}

export function setBody(patch: Partial<Body>) {
  setBodyState({ ...bodyOf(state), day: { ...state.day, body: { ...state.day.body, ...patch } } });
}

export function setPostureNow(posture: Posture) {
  dispatch({ name: "set_activity", args: { posture, from: Math.round(state.now) } });
}

export const isOnChart = (minute: number) => minute >= LANES.from && minute <= LANES.to;

// The minute a step shows. One with no time stays at the step before it, wherever you came from, and null
// means no step so far has named a time.
export function stepMinute(steps: readonly GuideStep[], index: number): number | null {
  for (let i = index; i >= 0; i--) {
    const { at } = steps[i];
    if (at !== null) return at;
  }
  return null;
}

const momentOfStep = (steps: readonly GuideStep[], index: number) => {
  const minute = stepMinute(steps, index);
  return minute !== null && !isOnChart(minute) ? minute : null;
};

// A step on an organ gives that organ one place in the outline: the section you are in if it belongs there,
// otherwise its own. A process would nest the row under it, and an organ in close-up draws no process line,
// so naming one on some steps and not others would only make the row jump between them.
function viewOfStep(body: BodyState, step: GuideStep): BodyState {
  const { organ } = step;
  const { view } = body;
  if (!organ)
    return {
      ...body,
      view: { ...view, system: step.system ?? view.system, process: step.process, focus: null, focusMuscle: null },
    };
  const belongsHere = systemById(view.system).organs.includes(organ);
  return {
    ...body,
    view: {
      ...view,
      system: belongsHere ? view.system : ORGAN_HOME[organ],
      process: null,
      focus: organ,
      focusMuscle: organ === "muscle" ? step.muscle : null,
    },
  };
}

let nextAskId = 1;

// From here on, everything that changes the body changes the copy.
export function enterAsk() {
  if (state.asking) return state.asking.id;
  const { trajectory, whatIf } = state;
  const id = nextAskId++;
  state = {
    ...state,
    view: { ...state.view, whatIf: null },
    whatIf: null,
    asking: {
      id,
      real: bodyOf(state),
      realDerived: { trajectory, whatIf },
      realT: state.t,
      history: [],
      guide: null,
      step: 0,
      guideOpen: false,
      moment: null,
      cancel: null,
    },
  };
  emit();
  return id;
}

// Puts your real day back exactly as it was, with the same objects, and drops the copy.
export function leaveAsk() {
  const asking = state.asking;
  if (!asking) return;
  asking.cancel?.();
  state = {
    ...state,
    ...asking.real,
    ...asking.realDerived,
    t: asking.realT,
    asking: null,
    playing: false,
    stop: null,
    touring: false,
    hover: null,
    hoverMuscle: null,
    hoverLane: null,
    fixing: null,
  };
  emit();
}

// Your day as a file. Nothing about what is on screen goes in, and neither does a copy being explored.
export function dayDocOf(s: AppState): DayDoc | null {
  if (!s.date || s.asking) return null;
  return { version: 1, date: s.date, ...s.day };
}

// Puts a saved day in place, keeping whatever view you are on.
export function restoreDay({ version: _version, date, ...day }: DayDoc, minute: number) {
  const atNow = Math.abs(state.t - state.now) < 1;
  setBodyState(
    { day, now: minute, view: { ...state.view, whatIf: null } },
    { date, dayProblem: null, ...(atNow ? { t: minute } : {}) },
  );
}

// The clock moved on. A view resting on now moves with it, and one you scrubbed away stays put.
export function setClock(minute: number) {
  if (minute === state.now) return;
  const atNow = !state.playing && Math.abs(state.t - state.now) < 1;
  setBodyState({ ...bodyOf(state), now: minute }, atNow ? { t: minute } : {});
}

export function setMode(mode: Mode) {
  if (mode === "tell") leaveAsk();
  setUi({ mode });
}

const openMoment = (s: AppState) => (s.asking?.guideOpen ? s.asking.moment : s.dayMoment);

// A muscle's story runs for days and the day chart only reaches one, so a step can show a minute off the
// chart. The muscle's close-up and its colour on the body read this, and everything else reads the chart.
export const muscleMinute = (s: AppState) => openMoment(s) ?? s.t;

export const chartOffsetHours = (s: AppState) => {
  const moment = openMoment(s);
  return moment === null ? null : Math.round((moment - s.t) / 60);
};

// Touching the chart means you want to see the chart's time.
export function releaseMoment() {
  if (openMoment(state) === null) return;
  state = { ...state, dayMoment: null, asking: state.asking && { ...state.asking, moment: null } };
  emit();
}

// Moves to a minute on a muscle's recovery, which can be any day: the chart's time if it reaches that far.
export function showMuscleMinute(minute: number) {
  setUi(isOnChart(minute) ? { t: minute, dayMoment: null, playing: false } : { dayMoment: minute, playing: false });
}

// While exploring, the screen is about the question. Your day is still in the model, because it changes the
// numbers, but what was already true of it stays off the screen, so only what differs from it shows.
export const yourDayWhileAsking = (s: AppState) => s.asking?.realDerived.trajectory ?? null;

export const stepOnScreen = (s: AppState) =>
  s.asking?.guideOpen && !s.touring ? (s.asking.guide?.[s.asking.step] ?? null) : null;

// A drawing Claude composed for the current step.
export const composedOnScreen = (s: AppState) => stepOnScreen(s)?.composed ?? null;

// The line an injury took through the body, while exploring one.
export const trackOnScreen = (s: AppState) =>
  s.asking ? (s.trajectory.events.find((event) => event.track && event.from <= s.t)?.track ?? null) : null;

// What the current walkthrough step points at in the close-up beside the body.
export const closeupOnScreen = (s: AppState) => stepOnScreen(s)?.closeup ?? null;

// The process the current step is about, when it stays on one organ.
export const processOnScreen = (s: AppState) => {
  const step = stepOnScreen(s);
  return step?.organ ? step.process : null;
};

export function goToStep(index: number) {
  const asking = state.asking;
  const step = asking?.guide?.[index];
  if (!asking || !step) return;
  setBodyState(viewOfStep(bodyOf(state), step), {
    asking: { ...asking, step: index, guideOpen: true, moment: momentOfStep(asking.guide ?? [], index) },
    stop: null,
    touring: false,
    playing: false,
  });
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
  const { whatIf } = state.view;
  if (whatIf)
    setBodyState({
      ...bodyOf(state),
      day: { ...state.day, activities: whatIf.activities },
      view: { ...state.view, whatIf: null },
    });
}

export function clearWhatIf() {
  setBodyState({ ...bodyOf(state), view: { ...state.view, whatIf: null } });
}

let nextExchangeId = 1;

export function beginExchange(text: string, scripted = false) {
  const exchange: Exchange = {
    id: nextExchangeId++,
    text,
    trace: [],
    reply: [],
    answer: "",
    status: "working",
    scripted,
    session: state.asking?.id ?? null,
    name: null,
  };
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
  return s.view.process ? (currentProcesses(s).find((p) => p.id === s.view.process) ?? null) : null;
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
