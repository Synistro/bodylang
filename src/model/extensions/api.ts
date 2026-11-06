import type { Evidence } from "../params";
import type { RouteId, SystemId, OrganId } from "../ids";
import type { Body } from "../scenario";
import type { SeriesName } from "../engine/trajectory";

// The contract for adding a process the model doesn't have. One file in this folder exports `extension`,
// and the app finds it, lists it, and draws it through the body like any other process.
//
// A process reads the model and can't change it. It gets every curve the model computes, and it answers
// one question: what is happening in this process at this minute. Nothing it does can move another number
// on screen, so a wrong process can only be wrong about itself.

// Everything a process can read.
export interface BodyView {
  readonly body: Readonly<Body>;
  readonly restingBpm: number;
  // Any curve of the model at any minute of today. The names are in SERIES in ../engine/trajectory.ts.
  value(name: SeriesName, minute: number): number;
  // What the person logged, such as an illness or a workout. `until` is null while it is still going on.
  readonly events: readonly {
    readonly label: string;
    readonly preset: string;
    readonly from: number;
    readonly until: number | null;
  }[];
}

// One numbered place along the line.
export interface ExtensionStop {
  id: string;
  organ: OrganId | null; // the organ it sits on, or null to sit where its route ends
  label: string; // one or two words
  reading: string; // the number at this stop, with its unit, or a word. An empty string shows nothing
  share: number; // 0 to 1: how much of the thing is here, or how strongly this stop is working. Drawn across the day
  flow: number; // 0 to 1: how fast it is moving into this stop. Sets how thick the line is
  say: string; // one or two plain sentences on what happens here now, at most 25 words
  routes: RouteId[]; // the vessels leading here from the previous stop. Empty for a jump
  from?: string; // the id of the stop this one branches from, if not the one before it
}

export interface ExtensionState {
  active: boolean; // false when nothing is happening in it right now
  headline: string; // one sentence on how it is now, under 14 words
  here: string | null; // the id of the stop where the action is now. Always one while active, and null when not
  stops: ExtensionStop[]; // 2 to 6
}

export interface ProcessExtension {
  id: string; // the file's name, in lowercase letters and underscores
  title: string; // "Thyroid"
  system: Exclude<SystemId, "overview">; // the part of the body it is listed under
  evidence: Evidence; // A: consistent human studies or official bodies. B: human studies with wide variation. C: your own estimate
  source: string; // where the numbers come from, naming the studies. Shown to the person
  params: Readonly<Record<string, number>>; // every tunable number, by name, so none hides in the code
  at(view: BodyView, minute: number): ExtensionState; // must be pure and cheap: it runs thousands of times
}
