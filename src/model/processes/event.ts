import { ChannelId, EventStop, ResolvedEvent } from "../events/types";
import { currentStopIndex, effectAt, eventActiveAt, eventLevelAt, isMuscleState } from "../events/curves";
import { muscleStateFromEvent, namesOf } from "../events/muscles";
import { PROCESS } from "../params";
import { levelWord, whenWords } from "../words";
import { Draft, Process, clock, hasStarted, numbered, shareOf } from "./line";
import { processIds } from "../ids";

const CHANNEL_TEXT: Record<ChannelId, (x: number) => string> = {
  heartRate: (x) => `${signed(x)} bpm`,
  breathing: (x) => `${signed(x)}/min`,
  temperature: (x) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} °C`,
  bloodPressure: (x) => `${signed(x)} mmHg`,
  stress: ofHundred,
  reward: ofHundred,
  drowsiness: ofHundred,
  inflammation: ofHundred,
  immune: ofHundred,
  metabolism: percentChange,
  insulinSensitivity: percentChange,
  liverOutput: percentChange,
  appetite: percentChange,
  fluidLoss: (x) => `${x.toFixed(1)} ml/min`,
  muscleFlow: percentChange,
};

function signed(x: number) {
  return `${x >= 0 ? "+" : ""}${Math.round(x)}`;
}

function percentChange(x: number) {
  return `${signed(x * 100)}%`;
}

function ofHundred(x: number) {
  return levelWord(x);
}

function eventHeadline(event: ResolvedEvent, t: number): string {
  const end = event.ends;
  const running = end === null || t <= end;
  switch (event.preset) {
    case "training": {
      const named = namesOf(event.muscles);
      if (running) return `Working your ${named}, with your heart pumping hard`;
      const peak = (end ?? t) + PROCESS.sorenessPeakMin;
      return t < peak
        ? `Repairing your ${named}, soreness peaks ${whenWords(peak, t)}`
        : `Your ${named} are healing, soreness easing`;
    }
    case "illness": {
      const fever = effectAt(event, "temperature", t);
      if (!running) return "Recovering, and insulin stays less effective for days";
      return fever >= PROCESS.feverNamedFromC
        ? `Immune system fighting it, temperature up ${fever.toFixed(1)} °C`
        : "Immune system fighting it, no fever";
    }
    case "sex":
      return running ? "Heart and blood pressure up for now" : "Heart rate back near baseline, prolactin stays raised";
    case "stress":
      return running
        ? "Stress hormones up, and your heart is beating faster"
        : "Easing off, with your heart still a little fast";
    case "poor_sleep":
      return "Insulin works less well today, and you may feel hungrier";
    case "custom":
      return running ? "The AI's estimate, still going on" : "The AI's estimate, fading";
    default: {
      const exhaustive: never = event.preset;
      return exhaustive;
    }
  }
}

function eventStop(
  event: ResolvedEvent,
  stop: EventStop,
  index: number,
  here: number,
  t: number,
  level: number,
): Draft {
  const elapsed = t - event.from;
  const isHere = index === here;
  const reached = stop.afterMin <= elapsed;
  let share = reached ? level : 0;
  let reading = stop.word ?? "";
  if (stop.shows !== undefined && reached) {
    if (isMuscleState(stop.shows)) {
      const group = stop.muscle ?? event.muscles[0]?.group;
      const work = event.muscles.find((m) => m.group === group);
      const state = work && event.ends !== null ? muscleStateFromEvent(event, event.ends, work.load, t)[stop.shows] : 0;
      share = state;
      reading = levelWord(state);
    } else {
      const amount = effectAt(event, stop.shows, t);
      const full = event.effects.reduce((sum, e) => (e.channel === stop.shows ? sum + Math.abs(e.amount) : sum), 0);
      share = shareOf(Math.abs(amount), full);
      reading = CHANNEL_TEXT[stop.shows](amount);
    }
    // A number that has already run its course says nothing worth reading.
    if (!isHere && share < PROCESS.stopFadedBelowShare) reading = "";
  }
  return {
    id: `stop-${index}`,
    organ: stop.organ,
    muscle: stop.muscle,
    label: stop.label,
    reading,
    share,
    flow: isHere ? Math.max(PROCESS.eventLineLeastFlow, level) : 0,
    say: stop.say,
    from: stop.branchOf === undefined ? undefined : `stop-${stop.branchOf}`,
    routes: stop.routes,
  };
}

export function eventProcess(event: ResolvedEvent, t: number): Process {
  const started = hasStarted(event.from, t);
  const active = started && eventActiveAt(event, t);
  const here = active ? Math.max(0, currentStopIndex(event, t)) : -1;
  const level = eventLevelAt(event, t);
  const drafts = event.stops.map((stop, index) => eventStop(event, stop, index, here, t, level));
  return {
    id: processIds.event(event.id),
    title: event.label,
    system: event.systems[0],
    alsoIn: event.systems.slice(1),
    substance: event.substance,
    active,
    headline: !started ? `Logged for ${clock(event.from)}` : active ? eventHeadline(event, t) : "Over",
    stops: numbered(drafts, here >= 0 ? `stop-${here}` : null, started ? "passed" : "ahead", event.liveStops),
  };
}
