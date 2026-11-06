import type { MuscleGroup } from "../muscleGroups";
import { DAY, PROCESS, REFERENCE } from "../params";
import { SeriesName, Trajectory, value } from "../engine/trajectory";
import { foodKcalOf, Intake, POSTURES } from "../scenario";
import { OrganId, processIds } from "../ids";
import { formatClock, inSentence, joinAnd } from "../words";
import type { SystemId, RouteId, Substance } from "../ids";
import { clamp01 } from "../curve";

export type StopState = "passed" | "here" | "ahead";

export interface ProcessStop {
  id: string;
  number: number; // 1-based, shown on the body and in the panel
  organ: OrganId | null;
  muscle: MuscleGroup | null; // a stop can point at one muscle group, with organ "muscle" alongside
  label: string; // "Stomach"
  reading: string; // "95%", "530 ml", "1.4×"
  share: number; // 0 to 1: how much of the thing is at this stop now
  state: StopState;
  flow: number; // 0 to 1: how fast it is moving into this stop right now; draws line weight and pulses
  say: string; // One or two plain sentences on what happens at this stop now. Shown during a walkthrough.
  from: string | null; // id of the stop this one branches from; null means the previous stop
  routes: RouteId[]; // the path from that stop to this one
}

export interface Process {
  id: string; // "intake:pizza", "insulin", "circulation", "alertness", "clearing", "fat-route"
  title: string; // "Pizza"
  system: SystemId;
  substance: Substance;
  alsoIn?: SystemId[]; // other systems this crosses, such as a workout showing under Heart & lungs
  active: boolean; // false when nothing is happening in it right now; the panel lists these quietly
  headline: string; // "95% still in your stomach, the first sugar is reaching your blood"
  stops: ProcessStop[];
}

// A stop before it is numbered and placed on its line.
export interface Draft {
  id: string;
  organ: OrganId | null;
  muscle?: MuscleGroup | null;
  label: string;
  reading: string;
  share: number;
  flow: number;
  say: string;
  from?: string;
  routes: RouteId[];
}

export const percent = (x: number) => `${Math.round(x * 100)}%`;
export const clock = formatClock;
export const shareOf = (part: number, total: number) => (total > 0 ? part / total : 0);
export const flowRate = (rate: number, full: number) => clamp01(Math.max(0, rate) / full);
export const hasStarted = (at: number, t: number) => at <= t;

// A zero says nothing a person can use, whatever its unit.
const NOTHING_THERE = /^0(\.0+)?( |%|$)/;

// Markers read along a line: what the action has left behind, where it is, what is next. A stop
// behind you says nothing. On a live line everything keeps going at once, so nothing is behind you.
export function numbered(drafts: Draft[], here: string | null, withoutHere: StopState, live = false): ProcessStop[] {
  const at = here === null ? -1 : drafts.findIndex((d) => d.id === here);
  return drafts.map((d, i) => {
    const state: StopState = at < 0 ? withoutHere : i === at ? "here" : i < at && !live ? "passed" : "ahead";
    return {
      id: d.id,
      number: i + 1,
      organ: d.organ,
      muscle: d.muscle ?? null,
      label: d.label,
      reading: state === "passed" || NOTHING_THERE.test(d.reading) ? "" : d.reading,
      share: clamp01(d.share),
      state,
      flow: clamp01(d.flow),
      say: d.say,
      from: d.from ?? null,
      routes: d.routes,
    };
  });
}

export function peakAfter(tr: Trajectory, name: SeriesName, t: number, horizon: number = REFERENCE.headingHorizonMin) {
  const series = tr.series[name];
  const start = Math.max(0, Math.min(DAY.minutes, Math.ceil(t)));
  const end = Math.min(DAY.minutes, start + horizon);
  let at = start;
  for (let m = start; m <= end; m++) if (series[m] > series[at]) at = m;
  // A window can close mid-climb. Follow the curve until it turns so a reported peak is a real one.
  if (at === end) while (at < DAY.minutes && series[at + 1] > series[at]) at++;
  return { at, value: series[at], ahead: at > t + 2 };
}

export const postureAt = (tr: Trajectory, t: number) => POSTURES[Math.round(value(tr, "posture", t))];
// Coffee with a splash of milk follows the caffeine alone; anything else with calories gets digested.
const isCaffeineDrink = (intake: Intake) => intake.caffeineMg > 0 && foodKcalOf(intake) < PROCESS.drinkOnlyBelowKcal;
export const hasFoodLine = (intake: Intake) => foodKcalOf(intake) > 0 && !isCaffeineDrink(intake);

// What you ate at one sitting, followed as one thing. Each group has at least one intake.
export function mealGroups(intakes: Intake[]): Intake[][] {
  const groups: Intake[][] = [];
  for (const intake of [...intakes].filter(hasFoodLine).sort((a, b) => a.at - b.at)) {
    const open = groups.find((group) => intake.at - group[0].at <= PROCESS.sameSittingMin);
    if (open) open.push(intake);
    else groups.push([intake]);
  }
  return groups;
}

export const mealProcessId = (group: Intake[]) =>
  group.length > 1 ? processIds.meal(group[0].id) : processIds.intake(group[0].id);

export function mealTitle(group: Intake[]): string {
  const names = joinAnd(group.map((intake) => inSentence(intake.label)));
  return group.every((intake) => intake.liquid) ? `Drank ${names}` : `Ate ${names}`;
}

// ---- What you ate, followed through the conserved ledger.
