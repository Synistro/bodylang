import { Process, processesAt, ProcessStop } from "./processes";
import type { Trajectory } from "./simulate";
import type { OrganId } from "./ids";

// Everything going on at one organ right now, whatever set it off: a meal, a coffee, a cigarette, an illness,
// or a process Claude added. Processes already say which organs they stop at, so an organ's page never has to
// know about any of them by name, and something new shows up on every organ it touches.
export interface Acting {
  process: Process;
  say: string;
  strength: number; // 0 to 1, how much of it is at this organ now
  from: OrganId | null; // the organ it reached this one from, when it travels
}

const GOING_ON_FROM = 0.04;
// Blood reaches everything all the time, and the liver's and kidneys' round-up repeats what each thing already
// says for itself, so neither earns a row of its own.
const LEFT_OUT = new Set(["circulation", "clearing"]);

// What Claude added runs all day, so what is particular to today comes first.
const particularToToday = (process: Process) => (process.id.startsWith("ext:") ? 0 : 1);

const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;

const strengthOf = (stop: ProcessStop) => (stop.state === "here" ? 1 : Math.max(stop.flow, stop.share));

// The way it reached this organ, from the first time it gets here: something inhaled starts in the lungs,
// however much it also acts on them later.
function cameFrom(process: Process, stop: ProcessStop): OrganId | null {
  const index = process.stops.indexOf(stop);
  const before = stop.from ? process.stops.find((other) => other.id === stop.from) : process.stops[index - 1];
  return before?.organ && before.organ !== stop.organ ? before.organ : null;
}

export function actingAt(tr: Trajectory, t: number, organ: OrganId): Acting[] {
  return processesAt(tr, t)
    .filter((process) => process.active && !LEFT_OUT.has(process.id))
    .flatMap((process): Acting[] => {
      const stops = process.stops.filter((stop) => stop.organ === organ && strengthOf(stop) >= GOING_ON_FROM);
      if (!stops.length) return [];
      const stop = stops.reduce((best, other) => (strengthOf(other) > strengthOf(best) ? other : best));
      return [{ process, say: firstSentence(stop.say), strength: strengthOf(stop), from: cameFrom(process, stops[0]) }];
    })
    .sort((a, b) => particularToToday(b.process) - particularToToday(a.process) || b.strength - a.strength);
}
