import { MuscleGroup } from "../muscleGroups";
import { Evidence } from "../params";
import type { RouteId, Substance, SystemId, OrganId } from "../ids";

// Anything that can happen to a body acts on the model through these quantities, so the rest of the
// model never needs to know whether a raised heart rate came from a fever or a workout.
export const CHANNELS = [
  "heartRate", // bpm added
  "breathing", // breaths per minute added
  "temperature", // degrees C added to core temperature
  "bloodPressure", // mmHg added to systolic
  "stress", // 0 to 1, adrenaline and cortisol together
  "reward", // 0 to 1, endorphins, dopamine, oxytocin together
  "drowsiness", // 0 to 1
  "inflammation", // 0 to 1, whole body signalling
  "immune", // 0 to 1, how hard the immune system is working
  "metabolism", // multiplier minus 1, 0.1 means 10% more energy burned
  "insulinSensitivity", // multiplier minus 1, -0.3 means 30% less sensitive
  "liverOutput", // multiplier minus 1 on glucose released by the liver
  "appetite", // -1 to 1
  "fluidLoss", // ml per minute lost through sweat and breath
  "muscleFlow", // added share of blood going to muscle, 0 to 1
] as const;

export type ChannelId = (typeof CHANNELS)[number];

// A time course. It climbs while the event runs and decays once it ends. With `after`, it starts
// when the event ends instead, climbs, then decays: the drowsiness after sex, the tiredness after a set.
export interface Curve {
  riseMin: number; // minutes to reach full strength
  halfLifeMin: number; // decay once it stops being driven
  after?: boolean;
  lastMin?: number; // only the final minutes of the event: a brief peak at the end
  settle?: { toShare: number; afterMin: number; halfLifeMin: number }; // a long event habituates to this share
}

export interface Effect extends Curve {
  channel: ChannelId;
  amount: number; // value at full strength
}

export interface MuscleWork {
  group: MuscleGroup;
  load: number; // 0 to 1, how hard this group worked
}

// What a stop can show live on the body: a channel this event moves, or a muscle's state.
export type StopShows = ChannelId | keyof MuscleState;

export interface EventStop {
  organ: OrganId | null;
  muscle: MuscleGroup | null;
  label: string;
  afterMin: number; // minutes after the event starts when this stop becomes the current one
  say: string; // under 25 words, plain
  routes: RouteId[]; // path from the previous stop, may be empty for a jump
  shows?: StopShows;
  word?: string; // what the stop reads when no live number says it better: "Irritated"
  branchOf?: number; // index of the stop this hangs off; it is never the current stop itself
}

export interface EventFeeling extends Curve {
  id: string; // "sore", "feverish", "tired", "coughing", "relaxed", "thirsty"
  label: string;
  amount: number; // 0 to 1 at full strength
  cause: string; // under 10 words
  organ: OrganId | null;
}

// Shown wherever this preset appears, whatever anyone called it, so every string stays clinical.
export const SEX_LABEL = "Sexual activity";

export const SYMPTOMS = ["cough", "fever", "congestion", "sore_throat", "fatigue"] as const;
export type Symptom = (typeof SYMPTOMS)[number];

export const PRESETS = ["training", "illness", "sex", "stress", "poor_sleep", "custom"] as const;
export type Preset = (typeof PRESETS)[number];

// What the store and the tool calls hold: what happened.
export interface BodyEvent {
  id: string;
  label: string; // what the person would call it: "Chest workout", "Cold"
  from: number; // minute of the day, negative for days before today
  until: number | null; // null while it is still going on, such as being ill
  preset: Preset;
  intensity: number; // 0 to 1
  muscles: MuscleWork[]; // training only
  symptoms: Symptom[]; // illness only
  custom: CustomStory | null; // custom only, supplied by Claude
  source: string; // custom only; presets carry their own
}

export interface CustomStory {
  systems: SystemId[];
  effects: Effect[];
  feelings: EventFeeling[];
  stops: EventStop[];
  track?: EventTrack | null; // for an injury: the straight line it took through the body
}

export const TRACK_FROM = ["front", "back", "left", "right", "above", "below"] as const;
export type TrackFrom = (typeof TRACK_FROM)[number];

export interface CrossedPart {
  organ: OrganId | null; // null for a vessel or the spinal cord
  name: string;
}

export interface EventTrack {
  aim: OrganId; // the organ it goes through
  from: TrackFrom; // the side of the body it comes from
  crossed?: CrossedPart[]; // what that line really crosses, worked out by the app
}

// What the model reads: the same thing with every curve resolved.
export interface ResolvedEvent extends BodyEvent {
  systems: SystemId[]; // the first one owns the process
  effects: Effect[];
  feelings: EventFeeling[];
  stops: EventStop[];
  track?: EventTrack | null;
  evidence: Evidence; // presets carry A or B from cited sources, custom is always C
  ends: number | null; // `until`, or a typical length for what cannot go on forever
  causeName: string; // the cause as it reads inside a reason: "the fever", "short sleep"
  substance: Substance;
  liveStops: boolean; // every stop keeps going while it lasts, so none of them is ever behind you
}

export interface MuscleState {
  work: number; // how hard it is working right now
  fatigue: number; // the strength it has lost for now
  soreness: number;
  repair: number; // how far protein synthesis is raised, 1 at its height
  glycogenUsed: number; // share of its glycogen burned and not yet refilled
}

export interface ActivityBout {
  from: number;
  end: number;
  posture: "walking" | "running";
  effects: Effect[];
}
