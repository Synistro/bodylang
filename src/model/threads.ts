import { eventLevelAt } from "./events/curves";
import { muscleStateFromEvent } from "./events/muscles";
import { ResolvedEvent } from "./events/types";
import { PROCESS, REFERENCE } from "./params";
import { hasFoodLine, mealGroups, mealProcessId, mealTitle, Process, ProcessStop } from "./processes/line";
import { processesAt } from "./processes/processes";
import { foodKcalOf } from "./scenario";
import { Trajectory, value } from "./engine/trajectory";
import { formatClock, inSentence } from "./words";

// One thing the person told the body about, shown on the top level as one line.
export interface Thread {
  id: string; // "meal:sugar_bar", "intake:coffee", "event:cold", "substance:ibuprofen"
  title: string; // "Ate sugar bar and pizza", "Drank coffee", "Chest and triceps workout", "Cold"
  name: string; // what it is, without the verb, where room is short: "Sugar bar + Pizza", "Coffee", "Cold"
  kind: "food" | "drink" | "substance" | "training" | "illness" | "other";
  since: string; // "15 min ago"
  status: string; // one or two plain words: "stomach", "repairing", "fading", "fighting it"
  active: boolean;
  processId: string;
  at: number; // when it started, for ordering
  importance: number; // what needs attention first: higher sorts earlier
}

function sinceWords(from: number, t: number) {
  const ago = t - from;
  if (ago < 0) return `at ${formatClock(from)}`;
  if (ago < 1) return "just now";
  if (ago < 60) return `${Math.round(ago)} min ago`;
  if (ago < 1440) return `${Math.round(ago / 60)} h ago`;
  const days = Math.round(ago / 1440);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const hereStop = (process: Process): ProcessStop | undefined => process.stops.find((s) => s.state === "here");

const FOOD_STATUS: Record<string, string> = { stomach: "in stomach", intestine: "absorbing" };

function foodStatus(process: Process, started: boolean) {
  const here = hereStop(process);
  if (here) return FOOD_STATUS[here.id] ?? "storing";
  return started ? "digested" : "later";
}

// A dose reads as absorbing, then working or fading by which way its effect is moving.
function doseStatus(process: Process, started: boolean, rising: boolean, fadingWord: string) {
  const here = hereStop(process);
  if (!here) return started ? "cleared" : "later";
  if (here.id === "stomach" || here.id === "intestine") return "absorbing";
  return rising ? "working" : fadingWord;
}

function muscleLoad(event: ResolvedEvent, t: number) {
  const state = { work: 0, soreness: 0, repair: 0 };
  if (event.ends === null) return state;
  for (const m of event.muscles) {
    const one = muscleStateFromEvent(event, event.ends, m.load, t);
    state.work = Math.max(state.work, one.work);
    state.soreness = Math.max(state.soreness, one.soreness);
    state.repair = Math.max(state.repair, one.repair);
  }
  return state;
}

function eventStatus(event: ResolvedEvent, t: number): string {
  if (t < event.from) return "later";
  const running = event.ends === null || t <= event.ends;
  const over = eventLevelAt(event, t) < PROCESS.threadOverBelow;
  switch (event.preset) {
    case "training": {
      const { work, soreness, repair } = muscleLoad(event, t);
      if (work >= REFERENCE.muscleState.workingFrom) return "working";
      if (soreness >= PROCESS.threadSoreFrom) return "sore";
      return repair >= REFERENCE.muscleState.repairingFrom ? "repairing" : "recovered";
    }
    case "illness":
      return running ? "fighting it" : over ? "over" : "recovering";
    case "sex":
      return running ? "under way" : over ? "over" : "recovering";
    case "stress":
      return running ? "raised" : over ? "over" : "easing";
    case "poor_sleep":
      return over ? "caught up" : "tired";
    case "custom":
      return over ? "over" : running ? "going on" : "fading";
    default: {
      const exhaustive: never = event.preset;
      return exhaustive;
    }
  }
}

const EVENT_KIND: Record<ResolvedEvent["preset"], Thread["kind"]> = { training: "training", illness: "illness", sex: "other", stress: "other", poor_sleep: "other", custom: "other" };

// Being ill outranks everything, then anything else that needs attention right now.
const IMPORTANCE = { illness: 2, attention: 1, ordinary: 0 } as const;

export function threadsAt(tr: Trajectory, t: number): Thread[] {
  const processes = new Map(processesAt(tr, t).map((p) => [p.id, p]));
  const thread = (id: string, title: string, name: string, kind: Thread["kind"], from: number, processId: string, importance: number, status: (process: Process) => string): Thread[] => {
    const process = processes.get(processId);
    if (!process) return [];
    return [{ id, title, name, kind, since: sinceWords(from, t), status: status(process), active: process.active, processId, at: from, importance: process.active ? importance : IMPORTANCE.ordinary }];
  };
  const risingAt = (name: "caffeineFelt" | "alcohol") => value(tr, name, t + PROCESS.flowWindowMin) > value(tr, name, t - PROCESS.flowWindowMin);
  const overAlcoholLimit = value(tr, "alcohol", t) >= REFERENCE.alcohol.riskGPerL;

  const fromMeals = mealGroups(tr.scenario.intakes)
    .filter((group) => group.some((intake) => intake.alcoholG === 0))
    .flatMap((group) => {
      const processId = mealProcessId(group);
      const drink = group.every((intake) => intake.liquid);
      return thread(processId, mealTitle(group), group.map((intake) => intake.label).join(" + "), drink ? "drink" : "food", group[0].at, processId, IMPORTANCE.ordinary, (p) => foodStatus(p, group[0].at <= t));
    });
  const fromDrinks = tr.scenario.intakes.flatMap((intake) => {
    const started = intake.at <= t;
    const id = `intake:${intake.id}`;
    const title = `Drank ${inSentence(intake.label)}`;
    if (intake.alcoholG > 0) return thread(id, title, intake.label, "drink", intake.at, `alcohol:${intake.id}`, overAlcoholLimit ? IMPORTANCE.attention : IMPORTANCE.ordinary, (p) => doseStatus(p, started, risingAt("alcohol"), "clearing"));
    if (intake.caffeineMg > 0 && !hasFoodLine(intake) && foodKcalOf(intake) < PROCESS.drinkOnlyBelowKcal) return thread(id, title, intake.label, "drink", intake.at, id, IMPORTANCE.ordinary, (p) => doseStatus(p, started, risingAt("caffeineFelt"), "fading"));
    return [];
  });
  const fromSubstances = tr.scenario.substances.flatMap((substance) => {
    const started = substance.at <= t;
    const id = `substance:${substance.id}`;
    const series = tr.substances.get(substance.id)?.series;
    const rising = series ? series[Math.min(series.length - 1, Math.max(0, Math.round(t) + PROCESS.flowWindowMin))] > series[Math.min(series.length - 1, Math.max(0, Math.round(t) - PROCESS.flowWindowMin))] : false;
    return thread(id, `Took ${inSentence(substance.label)}`, substance.label, "substance", substance.at, id, IMPORTANCE.ordinary, (p) => doseStatus(p, started, rising, "fading"));
  });
  const fromEvents = tr.events.flatMap((event) => {
    const id = `event:${event.id}`;
    const stressed = event.preset === "stress" && value(tr, "stressLevel", t) >= PROCESS.stressAttentionFrom;
    const importance = event.preset === "illness" ? IMPORTANCE.illness : stressed ? IMPORTANCE.attention : IMPORTANCE.ordinary;
    return thread(id, event.label, event.label, EVENT_KIND[event.preset], event.from, id, importance, () => eventStatus(event, t));
  });

  // What matters most comes first, then what is still going on, then the most recent.
  return [...fromMeals, ...fromDrinks, ...fromSubstances, ...fromEvents].sort((a, b) => b.importance - a.importance || Number(b.active) - Number(a.active) || b.at - a.at);
}
