import type { BodyView } from "../extensions/api";
import { EXTENSIONS } from "../extensions";
import { Trajectory, value } from "../engine/trajectory";
import type { SystemId } from "../ids";
import {
  alertnessProcess,
  circulationProcess,
  clearingProcess,
  cycleProcess,
  fatRouteProcess,
  insulinProcess,
} from "./body";
import { alcoholLine, caffeineLine, doseProcess, substanceLine } from "./dose";
import { eventProcess } from "./event";
import { foodProcess } from "./food";
import { Process, mealGroups, mealProcessId, numbered } from "./line";
import { processIds } from "../ids";

// Each builder adds the lines it knows about. A new kind of thing happening to the body is a new
// entry here, and none of them may assume another has anything to show.
type ProcessBuilder = (tr: Trajectory, t: number) => Process[];

const newestFirst = (tr: Trajectory) => [...tr.scenario.intakes].sort((a, b) => b.at - a.at);

// What a process Claude added gets to read: the model's curves and what was logged, and nothing it can change.
export function viewOf(tr: Trajectory): BodyView {
  return {
    body: tr.scenario.body,
    restingBpm: tr.anthro.restingBpm,
    value: (name, minute) => value(tr, name, minute),
    events: tr.events.map((event) => ({
      label: event.label,
      preset: event.preset,
      from: event.from,
      until: event.until,
    })),
  };
}

const broken = new Set<string>();

// A process Claude added runs through its tests before it gets here. One that still fails on a real day
// goes quiet rather than taking the page down, and says so once.
export function extensionLines(tr: Trajectory, t: number): Process[] {
  const view = viewOf(tr);
  return EXTENSIONS.flatMap((extension) => {
    try {
      const { active, headline, here, stops } = extension.at(view, t);
      return [
        {
          id: processIds.added(extension.id),
          title: extension.title,
          system: extension.system,
          substance: "other" as const,
          active,
          headline,
          stops: numbered(stops, here, "ahead", true),
        },
      ];
    } catch (e: unknown) {
      if (!broken.has(extension.id)) console.error(`The process ${extension.id} failed`, e);
      broken.add(extension.id);
      return [];
    }
  });
}

// What came over from yesterday is only worth a line while it is still doing something.
const stillHere = (from: number, line: Process) => (from >= 0 || line.active ? [line] : []);

const PROCESS_BUILDERS: ProcessBuilder[] = [
  (tr, t) =>
    mealGroups(tr.scenario.intakes)
      .reverse()
      .flatMap((group) => stillHere(group[0].at, foodProcess(tr, group, t))),
  (tr, t) =>
    newestFirst(tr)
      .filter((intake) => intake.caffeineMg > 0)
      .flatMap((intake) => stillHere(intake.at, doseProcess(caffeineLine(tr, intake, t), t))),
  (tr, t) => [insulinProcess(tr, t)],
  (tr, t) => [fatRouteProcess(tr, t)],
  (tr, t) => [circulationProcess(tr, t)],
  (tr, t) => [alertnessProcess(tr, t)],
  (tr, t) => [clearingProcess(tr, t)],
  (tr, t) => cycleProcess(tr, t),
  (tr, t) => extensionLines(tr, t),
  (tr, t) =>
    newestFirst(tr)
      .filter((intake) => intake.alcoholG > 0)
      .flatMap((intake) => stillHere(intake.at, doseProcess(alcoholLine(tr, intake, t), t))),
  (tr, t) =>
    tr.scenario.substances.flatMap((substance) =>
      stillHere(substance.at, doseProcess(substanceLine(tr, substance, t), t)),
    ),
  (tr, t) => [...tr.events].sort((a, b) => b.from - a.from).map((event) => eventProcess(event, t)),
];

export function processesAt(tr: Trajectory, t: number): Process[] {
  return PROCESS_BUILDERS.flatMap((build) => build(tr, t));
}

// The id a selected process has now. A food's id changes when it joins or leaves a meal, and anything
// removed has no line left to show.
export function followProcess(tr: Trajectory, id: string, t: number): string | null {
  if (processesAt(tr, t).some((p) => p.id === id)) return id;
  const food = /^(?:intake|meal):(.+)$/.exec(id)?.[1];
  const group =
    food === undefined
      ? undefined
      : mealGroups(tr.scenario.intakes).find((g) => g.some((intake) => intake.id === food));
  return group ? mealProcessId(group) : null;
}

export function processesFor(tr: Trajectory, t: number, system: SystemId): Process[] {
  return processesAt(tr, t).filter(
    (p) => system === "overview" || p.system === system || (p.alsoIn ?? []).includes(system),
  );
}
