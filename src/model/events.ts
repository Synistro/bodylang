import { MUSCLE_LABEL, MuscleGroup } from "./muscleGroups";
import { ACTIVITY, DAY, ENERGY, Evidence, HEART, ILLNESS, MUSCLE_MASS_SHARE, MUSCLE_RECOVERY, POOR_SLEEP, RESTING_SYSTOLIC_MMHG, SEX, STRESS, TRAINING } from "./params";
import type { RouteId, Substance } from "./processes";
import type { ActivitySpan, Anthropometrics, Body, OrganId } from "./simulate";
import type { SystemId } from "./systems";

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
}

// What the model reads: the same thing with every curve resolved.
export interface ResolvedEvent extends BodyEvent {
  systems: SystemId[]; // the first one owns the process
  effects: Effect[];
  feelings: EventFeeling[];
  stops: EventStop[];
  evidence: Evidence; // presets carry A or B from cited sources, custom is always C
  ends: number | null; // `until`, or a typical length for what cannot go on forever
  causeName: string; // the cause as it reads inside a reason: "the fever", "short sleep"
  substance: Substance;
  liveStops: boolean; // every stop keeps going while it lasts, so none of them is ever behind you
}

// Where something being fought actually is, read from the first stop of its story.
export function illnessSites(events: ResolvedEvent[], t: number, from: number): OrganId[] {
  return events.flatMap((event) => {
    const site = event.stops[0]?.organ;
    return site && event.ends === null && effectAt(event, "immune", t) >= from ? [site] : [];
  });
}

export interface MuscleState {
  work: number; // how hard it is working right now
  fatigue: number; // the strength it has lost for now
  soreness: number;
  repair: number; // how far protein synthesis is raised, 1 at its height
  glycogenUsed: number; // share of its glycogen burned and not yet refilled
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const decay = (minutes: number, halfLifeMin: number) => 0.5 ** (minutes / halfLifeMin);

// How far along a curve is at minute t, 0 to 1.
export function curveStrength(curve: Curve, from: number, end: number | null, t: number): number {
  if (curve.after) {
    if (end === null || t < end) return 0;
    const since = t - end;
    if (since < curve.riseMin) return since / curve.riseMin;
    return decay(since - curve.riseMin, curve.halfLifeMin);
  }
  if (curve.lastMin !== undefined && end === null) return 0;
  const start = curve.lastMin !== undefined && end !== null ? end - curve.lastMin : from;
  if (t < start) return 0;
  const held = (at: number) => {
    const reached = curve.riseMin > 0 ? Math.min(1, (at - start) / curve.riseMin) : 1;
    const { settle } = curve;
    if (!settle || at - from <= settle.afterMin) return reached;
    return reached * (settle.toShare + (1 - settle.toShare) * decay(at - from - settle.afterMin, settle.halfLifeMin));
  };
  return end === null || t <= end ? held(t) : held(end) * decay(t - end, curve.halfLifeMin);
}

const hours = (x: number) => x * 60;

// One group's state from one session, in closed form so it reads days past the simulated window.
export function muscleStateFromEvent(event: BodyEvent, end: number, load: number, t: number): MuscleState {
  const m = MUSCLE_RECOVERY;
  const strain = load * event.intensity;
  if (t < event.from || strain <= 0) return { work: 0, fatigue: 0, soreness: 0, repair: 0, glycogenUsed: 0 };
  const session = Math.max(1, end - event.from);
  const during = Math.min(1, (Math.min(t, end) - event.from) / session);
  if (t <= end) {
    return { work: clamp01(strain), fatigue: clamp01(strain * during), soreness: 0, repair: 0, glycogenUsed: clamp01(m.glycogenUsedAtFull * strain * during) };
  }
  const since = t - end;
  const sinceH = since / 60;
  const phase = sinceH / m.sorenessPeakH;
  return {
    work: clamp01(strain * decay(since, m.workFallHalfLifeMin)),
    fatigue: clamp01(strain * decay(since, hours(m.fatigueHalfLifeH))),
    soreness: clamp01(strain * phase ** m.sorenessShape * Math.exp(m.sorenessShape * (1 - phase))),
    repair: clamp01(strain * Math.min(1, since / m.repairRiseMin) * decay(Math.max(0, since - m.repairRiseMin), hours(m.repairHalfLifeH))),
    glycogenUsed: clamp01(m.glycogenUsedAtFull * strain * decay(since, m.glycogenRefillHalfLifeMin)),
  };
}

export function endOf(event: BodyEvent): number | null {
  if (event.until !== null) return event.until;
  switch (event.preset) {
    case "training":
      return event.from + TRAINING.defaultMinutes;
    case "sex":
      return event.from + SEX.defaultMinutes;
    case "poor_sleep":
      return Math.max(event.from + 1, DAY.sleepMin);
    case "illness":
    case "stress":
    case "custom":
      return null;
    default: {
      const exhaustive: never = event.preset;
      return exhaustive;
    }
  }
}

// A muscle's state across every event, added up: reads any minute, today or days from now.
export function muscleStateAt(events: BodyEvent[], group: MuscleGroup, minute: number): MuscleState {
  const total: MuscleState = { work: 0, fatigue: 0, soreness: 0, repair: 0, glycogenUsed: 0 };
  for (const event of events) {
    const work = event.muscles.find((m) => m.group === group);
    const end = endOf(event);
    if (!work || end === null) continue;
    const one = muscleStateFromEvent(event, end, work.load, minute);
    total.work += one.work;
    total.fatigue += one.fatigue;
    total.soreness += one.soreness;
    total.repair += one.repair;
    total.glycogenUsed += one.glycogenUsed;
  }
  return { work: clamp01(total.work), fatigue: clamp01(total.fatigue), soreness: clamp01(total.soreness), repair: clamp01(total.repair), glycogenUsed: clamp01(total.glycogenUsed) };
}

// A muscle's state told as what happens to its fibres: how hard they work, how much is torn and not yet
// repaired, how sore it feels, and how much has been rebuilt. Damage builds through a session, and repair
// work then stands for what is still torn. What repair has finished is what has been rebuilt.
export function muscleStoryAt(events: BodyEvent[], group: MuscleGroup, minute: number) {
  const { work, fatigue, soreness, repair } = muscleStateAt(events, group, minute);
  let strained = 0;
  let during = false;
  for (const event of events) {
    const worked = event.muscles.find((m) => m.group === group);
    const end = endOf(event);
    if (!worked || end === null || minute < event.from) continue;
    if (minute <= end) during = true;
    else strained += worked.load * event.intensity;
  }
  return {
    load: during ? work : 0,
    damage: clamp01(during ? fatigue : repair),
    soreness,
    healed: clamp01(Math.max(0, strained - repair)),
  };
}

export const maxHeartRate = (age: number) => TRAINING.maxHeartRate.intercept - TRAINING.maxHeartRate.perYearOfAge * age;

export const namesOf = (muscles: MuscleWork[]) => {
  const names = [...muscles].sort((a, b) => b.load - a.load).map((m) => MUSCLE_LABEL[m.group].toLowerCase());
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} and more` : names.join(" and ");
};

// One muscle anchors each of the first stops, so the line visits what actually worked.
const WORK_STOPS_MAX = 3;

// What a preset needs to know about this particular body.
export type EventBody = { body: Body; anthro: Pick<Anthropometrics, "restingBpm" | "bmrKcalPerDay"> };

// One MET is about 1 kcal per kg per hour on top of resting burn.
const restingPlus = (anthro: EventBody["anthro"], body: Body, met: number) => anthro.bmrKcalPerDay / 24 + (met - 1) * body.weightKg;

// What walking and running do, as curves the channels can carry.
function boutEffects(posture: "walking" | "running", { body, anthro }: EventBody): Effect[] {
  const a = ACTIVITY;
  const sittingBpm = anthro.restingBpm + HEART.byActivity.sitting;
  const targetBpm = anthro.restingBpm + (maxHeartRate(body.age) - anthro.restingBpm) * a.heartReserve[posture];
  return [
    { channel: "heartRate", amount: targetBpm - sittingBpm, riseMin: a.heart.riseMin, halfLifeMin: a.heart.halfLifeMin },
    { channel: "breathing", amount: a.breaths[posture], riseMin: a.breaths.riseMin, halfLifeMin: a.breaths.halfLifeMin },
    { channel: "fluidLoss", amount: a.sweatMlPerMin[posture], riseMin: a.sweatMlPerMin.riseMin, halfLifeMin: a.sweatMlPerMin.halfLifeMin },
    { channel: "temperature", amount: a.temperatureC[posture], riseMin: a.temperatureC.riseMin, halfLifeMin: a.temperatureC.halfLifeMin },
    { channel: "bloodPressure", amount: a.systolicMmHg[posture], riseMin: a.systolicMmHg.riseMin, halfLifeMin: a.systolicMmHg.halfLifeMin },
  ];
}

export interface ActivityBout {
  from: number;
  end: number;
  posture: "walking" | "running";
  effects: Effect[];
}

// Each stretch of walking or running in the activity list, ending at the next span or at bedtime.
export function activityBouts(spans: ActivitySpan[], who: EventBody): ActivityBout[] {
  const bouts: ActivityBout[] = [];
  spans.forEach((span, i) => {
    if (span.posture !== "walking" && span.posture !== "running") return;
    const next = spans[i + 1]?.from ?? (span.from < DAY.sleepMin ? DAY.sleepMin : DAY.minutes);
    bouts.push({ from: span.from, end: span.from < DAY.sleepMin ? Math.min(next, DAY.sleepMin) : next, posture: span.posture, effects: boutEffects(span.posture, who) });
  });
  return bouts;
}

// A run works the legs, so it reads through muscle state like a logged session.
export function runSessions(spans: ActivitySpan[]): BodyEvent[] {
  const s = ACTIVITY.runSoreness;
  const sessions: BodyEvent[] = [];
  spans.forEach((span, i) => {
    if (span.posture !== "running") return;
    const until = spans[i + 1]?.from ?? DAY.sleepMin;
    if (until - span.from < s.fromMinutes) return;
    sessions.push({ id: `run-${span.from}`, label: "Run", from: span.from, until, preset: "training", intensity: s.intensity, muscles: s.muscles.map((m) => ({ group: m.group, load: m.load })), symptoms: [], custom: null, source: "" });
  });
  return sessions;
}

function trainingStory(event: BodyEvent, { body, anthro }: EventBody): Story {
  const i = event.intensity;
  const r = TRAINING;
  const sittingBpm = anthro.restingBpm + HEART.byActivity.sitting;
  const targetBpm = sittingBpm + (maxHeartRate(body.age) - sittingBpm) * (r.heartReserve.atZero + r.heartReserve.gain * i);
  const mets = r.mets.light + (r.mets.hard - r.mets.light) * i;
  const end = endOf(event) ?? event.from + r.defaultMinutes;
  const session = end - event.from;
  const worked = [...event.muscles].sort((a, b) => b.load - a.load);
  const main = worked[0]?.group ?? null;
  const named = namesOf(event.muscles);
  const workStops: EventStop[] = worked.slice(0, WORK_STOPS_MAX).map((m, index) => ({
    organ: "muscle",
    muscle: m.group,
    label: MUSCLE_LABEL[m.group],
    afterMin: index,
    say: index === 0 ? "Working muscle burns glycogen and pulls sugar from your blood." : `${MUSCLE_LABEL[m.group]} help too, at about ${Math.round((m.load / worked[0].load) * 100)}% of the load.`,
    routes: index === 0 ? ["arch", "descending"] : [],
    shows: "work",
  }));
  return {
    systems: ["muscles", "circulation", "energy"],
    effects: [
      { channel: "heartRate", amount: targetBpm - sittingBpm, riseMin: r.heart.riseMin, halfLifeMin: r.heart.halfLifeMin },
      { channel: "breathing", amount: r.breathing.atZero + r.breathing.gain * i, riseMin: r.breathing.riseMin, halfLifeMin: r.breathing.halfLifeMin },
      { channel: "temperature", amount: r.temperature.gain * i, riseMin: r.temperature.riseMin, halfLifeMin: r.temperature.halfLifeMin },
      { channel: "bloodPressure", amount: r.systolic.atZero + r.systolic.gain * i, riseMin: r.systolic.riseMin, halfLifeMin: r.systolic.halfLifeMin },
      { channel: "stress", amount: r.stress.atZero + r.stress.gain * i, riseMin: r.stress.riseMin, halfLifeMin: r.stress.halfLifeMin },
      { channel: "reward", amount: r.reward.gain * i, riseMin: r.reward.riseMin, halfLifeMin: r.reward.halfLifeMin },
      { channel: "metabolism", amount: restingPlus(anthro, body, mets) / restingPlus(anthro, body, ENERGY.mets.sitting) - 1, riseMin: r.heart.riseMin, halfLifeMin: r.heart.halfLifeMin },
      { channel: "fluidLoss", amount: r.sweatMlPerMin.atZero + r.sweatMlPerMin.gain * i, riseMin: r.sweatMlPerMin.riseMin, halfLifeMin: r.sweatMlPerMin.halfLifeMin },
      { channel: "muscleFlow", amount: r.muscleFlow.atZero + r.muscleFlow.gain * i, riseMin: r.muscleFlow.riseMin, halfLifeMin: r.muscleFlow.halfLifeMin },
    ],
    feelings: [{ id: "tired", label: "Tired", amount: r.tired.atZero + r.tired.gain * i, riseMin: r.tired.riseMin, halfLifeMin: r.tired.halfLifeMin, after: true, cause: `You worked your ${named}`, organ: "muscle" }],
    stops: [
      ...workStops,
      { organ: "heart", muscle: null, label: "Heart", afterMin: WORK_STOPS_MAX, say: `Your heart climbs toward ${Math.round(targetBpm)} bpm and sends more blood to the working muscle.`, routes: ["arch", "descending"], shows: "heartRate" },
      { organ: "liver", muscle: null, label: "Liver", afterMin: session, say: "Your liver replaced the sugar muscle took. Now muscle refills its glycogen, with insulin working better for hours.", routes: ["to_liver_art"], shows: "glycogenUsed" },
      { organ: "muscle", muscle: main, label: "Repair", afterMin: session + MUSCLE_RECOVERY.repairRiseMin, say: "Protein building runs about double at 3 hours and stays raised past 48 hours.", routes: [], shows: "repair" },
      { organ: "muscle", muscle: main, label: "Soreness", afterMin: session + hours(12), say: "Soreness builds from about 12 hours and peaks a day or two after the session.", routes: [], shows: "soreness" },
    ],
    evidence: r.evidence,
    source: r.source,
    ends: end,
    causeName: `the ${event.label.toLowerCase()}`,
    substance: "other",
    label: event.label,
    liveStops: false,
  };
}

const ILLNESS_FEELINGS: Record<Symptom, (severity: number, feverC: number) => EventFeeling> = {
  cough: (s) => ({ id: "coughing", label: "Coughing", amount: 0.3 + 0.6 * s, riseMin: ILLNESS.rise.slow, halfLifeMin: ILLNESS.halfLife.slow, cause: "Irritated airways trigger the reflex", organ: "lungs" }),
  fever: (_s, feverC) => ({ id: "feverish", label: "Feverish", amount: Math.min(1, feverC / ILLNESS.feverAtFullC), riseMin: ILLNESS.rise.fever, halfLifeMin: ILLNESS.halfLife.fever, cause: `Your temperature is up about ${feverC.toFixed(1)} °C`, organ: "brain" }),
  congestion: (s) => ({ id: "stuffy", label: "Stuffy", amount: 0.3 + 0.5 * s, riseMin: ILLNESS.rise.slow, halfLifeMin: ILLNESS.halfLife.slow, cause: "Swollen lining in your nose", organ: "lungs" }),
  sore_throat: (s) => ({ id: "sore_throat", label: "Sore throat", amount: 0.3 + 0.5 * s, riseMin: ILLNESS.rise.slow, halfLifeMin: ILLNESS.halfLife.slow, cause: "Your throat lining is inflamed", organ: "lungs" }),
  fatigue: (s) => ({ id: "tired", label: "Tired", amount: 0.3 + 0.6 * s, riseMin: ILLNESS.rise.slow, halfLifeMin: ILLNESS.halfLife.slow, cause: "Immune signals are slowing you down", organ: "brain" }),
};

function illnessStory(event: BodyEvent): Story {
  const s = event.intensity;
  const r = ILLNESS;
  const has = (symptom: Symptom) => event.symptoms.includes(symptom);
  const feverC = has("fever") ? r.feverAtFullC * s : 0;
  const name = event.label.toLowerCase();
  const stops: EventStop[] = [
    { organ: "lungs", muscle: null, label: "Airways", afterMin: r.stopAfterMin.airway, say: "The virus inflames your airway lining, and nerves there become easier to set off.", routes: [], word: "Irritated" },
    { organ: "spleen", muscle: null, label: "Immune system", afterMin: r.stopAfterMin.immune, say: "Immune cells multiply and fight it. This costs energy and makes muscle resist insulin.", routes: [], word: "Responding" },
  ];
  if (feverC > 0) stops.push({ organ: "brain", muscle: null, label: "Brain", afterMin: r.stopAfterMin.brain, say: "Your immune system turned up your temperature, using a signal to your brain.", routes: [], shows: "temperature" });
  if (has("cough")) stops.push({ organ: "muscle", muscle: "abs", label: "Cough reflex", afterMin: r.stopAfterMin.airway, say: "Nerves in your airways fire the reflex. Your abs squeeze against a closed throat, then air bursts out.", routes: [], word: "Active", branchOf: 0 });
  return {
    systems: ["immune", "circulation", "energy", "brain"],
    effects: [
      { channel: "immune", amount: r.immuneAtZero + r.immuneGain * s, riseMin: r.rise.immune, halfLifeMin: r.halfLife.immune },
      { channel: "inflammation", amount: r.inflammationAtFull * s, riseMin: r.rise.inflammation, halfLifeMin: r.halfLife.inflammation },
      ...(feverC > 0
        ? ([
            { channel: "temperature", amount: feverC, riseMin: r.rise.fever, halfLifeMin: r.halfLife.fever },
            { channel: "breathing", amount: r.breathsPerC * feverC, riseMin: r.rise.fever, halfLifeMin: r.halfLife.fever },
            { channel: "metabolism", amount: r.metabolismPerC * feverC, riseMin: r.rise.fever, halfLifeMin: r.halfLife.fever },
            { channel: "fluidLoss", amount: r.fluidMlPerMinPerC * feverC, riseMin: r.rise.fever, halfLifeMin: r.halfLife.fever },
          ] satisfies Effect[])
        : []),
      { channel: "heartRate", amount: feverC > 0 ? r.heartBpmPerC * feverC : r.heartAtFullWithoutFever * s, riseMin: r.rise.heart, halfLifeMin: r.halfLife.heart },
      { channel: "insulinSensitivity", amount: r.insulinSensitivityAtFull * s, riseMin: r.rise.sensitivity, halfLifeMin: r.insulinRecoveryHalfLifeMin },
      { channel: "stress", amount: r.stressAtFull * s, riseMin: r.rise.slow, halfLifeMin: r.halfLife.slow },
      { channel: "appetite", amount: r.appetiteAtFull * s, riseMin: r.rise.slow, halfLifeMin: r.halfLife.slow },
      { channel: "drowsiness", amount: (has("fatigue") ? r.drowsinessWithFatigueAtFull : r.drowsinessAtFull) * s, riseMin: r.rise.slow, halfLifeMin: r.halfLife.slow },
    ],
    feelings: event.symptoms.map((symptom) => ILLNESS_FEELINGS[symptom](s, feverC)),
    stops,
    evidence: r.evidence,
    source: r.source,
    ends: event.until,
    causeName: `the ${name}`,
    substance: "other",
    label: event.label,
    liveStops: true,
  };
}

function sexStory(event: BodyEvent, { body, anthro }: EventBody): Story {
  const i = event.intensity;
  const r = SEX;
  const sittingBpm = anthro.restingBpm + HEART.byActivity.sitting;
  const peak = sittingBpm + (r.peakBpm - sittingBpm) * i;
  const end = endOf(event) ?? event.from + r.defaultMinutes;
  const session = end - event.from;
  const typicalKcalPerMin = r.kcalPerMin[body.sex] * (i / r.defaultIntensity);
  const sittingKcalPerMin = restingPlus(anthro, body, ENERGY.mets.sitting) / 60;
  return {
    systems: ["circulation", "brain"],
    effects: [
      { channel: "heartRate", amount: (peak - sittingBpm) * r.sustainedShare, riseMin: r.heart.riseMin, halfLifeMin: r.heart.halfLifeMin },
      { channel: "heartRate", amount: (peak - sittingBpm) * (1 - r.sustainedShare), riseMin: r.briefPeakMin, halfLifeMin: r.heart.halfLifeMin, lastMin: r.briefPeakMin },
      { channel: "bloodPressure", amount: (r.peakSystolic - RESTING_SYSTOLIC_MMHG) * i * r.sustainedShare, riseMin: r.systolic.riseMin, halfLifeMin: r.systolic.halfLifeMin },
      { channel: "bloodPressure", amount: (r.peakSystolic - RESTING_SYSTOLIC_MMHG) * i * (1 - r.sustainedShare), riseMin: r.briefPeakMin, halfLifeMin: r.systolic.halfLifeMin, lastMin: r.briefPeakMin },
      { channel: "breathing", amount: r.breathing.gain * i, riseMin: r.breathing.riseMin, halfLifeMin: r.breathing.halfLifeMin },
      { channel: "metabolism", amount: Math.max(0, typicalKcalPerMin / sittingKcalPerMin - 1), riseMin: r.metabolism.riseMin, halfLifeMin: r.metabolism.halfLifeMin },
      { channel: "stress", amount: r.stress.gain * i, riseMin: r.stress.riseMin, halfLifeMin: r.stress.halfLifeMin },
      { channel: "reward", amount: r.reward.gain * i, riseMin: r.reward.riseMin, halfLifeMin: r.reward.halfLifeMin },
      { channel: "drowsiness", amount: r.drowsiness.gain * i, riseMin: r.drowsiness.riseMin, halfLifeMin: r.drowsiness.halfLifeMin, after: true },
    ],
    feelings: [{ id: "relaxed", label: "Relaxed", amount: r.relaxed.gain * i, riseMin: r.relaxed.riseMin, halfLifeMin: r.relaxed.halfLifeMin, after: true, cause: "Prolactin and oxytocin are raised", organ: "brain" }],
    stops: [
      { organ: "brain", muscle: null, label: "Arousal", afterMin: 0, say: "Arousal raises sympathetic nerve activity and noradrenaline.", routes: ["carotid"], shows: "stress" },
      { organ: "heart", muscle: null, label: "Heart", afterMin: 5, say: `Heart rate and blood pressure rise, peaking briefly near ${Math.round(peak)} bpm.`, routes: ["from_brain"], shows: "heartRate" },
      { organ: "brain", muscle: null, label: "Hormones", afterMin: session, say: "Prolactin stays raised for over an hour after orgasm, and oxytocin rises too.", routes: ["arch", "carotid"], shows: "reward" },
      { organ: "heart", muscle: null, label: "Recovery", afterMin: session + 5, say: "Heart rate returns close to baseline within minutes. Drowsiness is common.", routes: ["from_brain"], shows: "drowsiness" },
    ],
    evidence: r.evidence,
    source: r.source,
    ends: end,
    causeName: "sexual activity",
    substance: "other",
    label: SEX_LABEL,
    liveStops: false,
  };
}

function stressStory(event: BodyEvent): Story {
  const i = event.intensity;
  const r = STRESS;
  return {
    systems: ["brain", "circulation", "digestion"],
    effects: [
      { channel: "heartRate", amount: r.heartAtFull * i, riseMin: r.heart.riseMin, halfLifeMin: r.heart.halfLifeMin, settle: r.settle },
      { channel: "bloodPressure", amount: r.systolicAtFull * i, riseMin: r.systolic.riseMin, halfLifeMin: r.systolic.halfLifeMin, settle: r.settle },
      { channel: "breathing", amount: r.breathingAtFull * i, riseMin: r.heart.riseMin, halfLifeMin: r.heart.halfLifeMin },
      { channel: "stress", amount: r.stress.gain * i, riseMin: r.stress.riseMin, halfLifeMin: r.stress.halfLifeMin },
      { channel: "liverOutput", amount: r.liverOutputAtFull * i, riseMin: r.stress.riseMin, halfLifeMin: r.stress.halfLifeMin },
      { channel: "metabolism", amount: r.metabolismAtFull * i, riseMin: r.heart.riseMin, halfLifeMin: r.heart.halfLifeMin },
      { channel: "appetite", amount: r.appetiteAtFull * i, riseMin: r.stress.riseMin, halfLifeMin: r.stress.halfLifeMin },
    ],
    feelings: [{ id: "tense", label: "Tense", amount: r.tense.gain * i, riseMin: r.tense.riseMin, halfLifeMin: r.tense.halfLifeMin, cause: "Adrenaline and cortisol are up", organ: "brain" }],
    stops: [
      { organ: "brain", muscle: null, label: "Brain", afterMin: r.stopAfterMin.brain, say: "Your brain reads a threat and signals your adrenal glands.", routes: [], shows: "stress" },
      { organ: "kidneys", muscle: null, label: "Adrenal glands", afterMin: r.stopAfterMin.adrenals, say: "Sitting on your kidneys, they release adrenaline in seconds and cortisol over minutes.", routes: ["from_brain", "descending", "to_kidney_L"] },
      { organ: "heart", muscle: null, label: "Heart", afterMin: r.stopAfterMin.heart, say: "Adrenaline speeds your heart and raises your blood pressure.", routes: ["from_kidney_L"], shows: "heartRate" },
      { organ: "liver", muscle: null, label: "Liver", afterMin: r.stopAfterMin.liver, say: "Your liver releases a little more sugar, ready for action.", routes: ["to_liver_art"], shows: "liverOutput" },
      { organ: "stomach", muscle: null, label: "Gut", afterMin: r.stopAfterMin.gut, say: "Blood moves away from your gut, and your stomach empties more slowly.", routes: ["to_gut"] },
    ],
    evidence: r.evidence,
    source: r.source,
    ends: event.until,
    // "Stress" is a state, so it reads without an article; anything else is the named thing.
    causeName: event.label.toLowerCase() === "stress" ? "stress" : `the ${event.label.toLowerCase()}`,
    substance: "other",
    label: event.label,
    liveStops: false,
  };
}

function poorSleepStory(event: BodyEvent): Story {
  const i = event.intensity;
  const r = POOR_SLEEP;
  const curve = { riseMin: r.riseMin, halfLifeMin: r.halfLifeMin };
  return {
    systems: ["brain", "energy"],
    effects: [
      { channel: "insulinSensitivity", amount: r.insulinSensitivityAtFull * i, ...curve },
      { channel: "appetite", amount: r.appetiteAtFull * i, ...curve },
      { channel: "drowsiness", amount: r.drowsinessAtFull * i, ...curve },
    ],
    feelings: [{ id: "tired", label: "Tired", amount: r.tired.gain * i, riseMin: r.tired.riseMin, halfLifeMin: r.tired.halfLifeMin, cause: "You slept short last night", organ: "brain" }],
    stops: [
      { organ: "brain", muscle: null, label: "Brain", afterMin: 0, say: "Sleep pressure was not fully cleared, so attention lapses and you feel drowsy.", routes: [], shows: "drowsiness" },
      { organ: "muscle", muscle: null, label: "Muscle", afterMin: 1, say: "Muscle and liver answer insulin about a quarter less after 4 hours of sleep.", routes: ["arch", "descending", "leg_L"], shows: "insulinSensitivity" },
      { organ: "stomach", muscle: null, label: "Appetite", afterMin: 2, say: "Hunger hormones shift, so hunger runs about a quarter higher.", routes: [], shows: "appetite" },
    ],
    evidence: r.evidence,
    source: r.source,
    ends: endOf(event),
    causeName: "short sleep",
    substance: "other",
    label: event.label,
    liveStops: false,
  };
}

type Story = Pick<ResolvedEvent, "systems" | "effects" | "feelings" | "stops" | "evidence" | "source" | "ends" | "causeName" | "substance" | "label" | "liveStops">;

// Each preset is a pure function of the event and the body. A new kind of event is a new row, or a
// custom story from Claude when none fits.
export function resolveEvent(event: BodyEvent, who: EventBody): ResolvedEvent {
  switch (event.preset) {
    case "training":
      return { ...event, ...trainingStory(event, who) };
    case "illness":
      return { ...event, ...illnessStory(event) };
    case "sex":
      return { ...event, ...sexStory(event, who) };
    case "stress":
      return { ...event, ...stressStory(event) };
    case "poor_sleep":
      return { ...event, ...poorSleepStory(event) };
    case "custom": {
      if (!event.custom) throw new Error(`Custom event ${event.id} has no story`);
      return { ...event, ...event.custom, evidence: "C", ends: event.until, causeName: event.label.toLowerCase(), substance: "other", source: event.source || "Claude's estimate", liveStops: false };
    }
    default: {
      const exhaustive: never = event.preset;
      return exhaustive;
    }
  }
}

// A channel's value from one event at one minute.
export const effectAt = (event: ResolvedEvent, channel: ChannelId, t: number) => event.effects.reduce((sum, e) => (e.channel === channel ? sum + e.amount * curveStrength(e, event.from, event.ends, t) : sum), 0);

// Channels nothing pushes on share this one array, so a recompute stays cheap with no events.
// Index 0 is minute `start`, which is before 00:00 today when yesterday is being run first.
export function channelSeries(events: ResolvedEvent[], minutes: number, bouts: ActivityBout[] = [], start = 0): Record<ChannelId, Float32Array> {
  const zero = new Float32Array(minutes);
  const series: Record<ChannelId, Float32Array> = {
    heartRate: zero,
    breathing: zero,
    temperature: zero,
    bloodPressure: zero,
    stress: zero,
    reward: zero,
    drowsiness: zero,
    inflammation: zero,
    immune: zero,
    metabolism: zero,
    insulinSensitivity: zero,
    liverOutput: zero,
    appetite: zero,
    fluidLoss: zero,
    muscleFlow: zero,
  };
  const sources: { from: number; end: number | null; effects: Effect[] }[] = [...events.map((e) => ({ from: e.from, end: e.ends, effects: e.effects })), ...bouts];
  for (const source of sources) {
    for (const effect of source.effects) {
      if (series[effect.channel] === zero) series[effect.channel] = new Float32Array(minutes);
      const out = series[effect.channel];
      for (let i = 0; i < minutes; i++) out[i] += effect.amount * curveStrength(effect, source.from, source.end, i + start);
    }
  }
  return series;
}

// Share of the body's muscle working at each minute, weighted by how much muscle each group holds.
export function muscleWorkSeries(events: ResolvedEvent[], minutes: number, start = 0): Float32Array {
  const out = new Float32Array(minutes);
  for (const event of events) {
    if (event.ends === null || !event.muscles.length) continue;
    const share = event.muscles.reduce((sum, m) => sum + m.load * MUSCLE_MASS_SHARE[m.group], 0) * event.intensity;
    const fall = MUSCLE_RECOVERY.workFallHalfLifeMin;
    for (let i = Math.max(0, event.from - start); i < minutes; i++) {
      const t = i + start;
      out[i] += t <= event.ends ? share : share * decay(t - event.ends, fall);
    }
  }
  return out;
}

// How much is still going on from this event, 0 to 1. Below the active floor it counts as over.
export function eventLevelAt(event: ResolvedEvent, t: number): number {
  if (t < event.from) return 0;
  let level = 0;
  for (const effect of event.effects) level = Math.max(level, curveStrength(effect, event.from, event.ends, t));
  for (const feeling of event.feelings) level = Math.max(level, curveStrength(feeling, event.from, event.ends, t));
  if (event.ends !== null) {
    for (const m of event.muscles) {
      const s = muscleStateFromEvent(event, event.ends, m.load, t);
      level = Math.max(level, s.work, s.fatigue, s.soreness, s.repair);
    }
  }
  return level;
}

export const eventActiveAt = (event: ResolvedEvent, t: number) => eventLevelAt(event, t) >= MUSCLE_RECOVERY.activeAbove;

// Which stop is current: the last one on the main line whose time has come.
export function currentStopIndex(event: ResolvedEvent, t: number): number {
  const elapsed = t - event.from;
  let at = -1;
  event.stops.forEach((stop, index) => {
    if (stop.afterMin <= elapsed && stop.branchOf === undefined) at = index;
  });
  return at;
}

export const MUSCLE_STATES: readonly (keyof MuscleState)[] = ["work", "fatigue", "soreness", "repair", "glycogenUsed"];

export const isMuscleState = (shows: StopShows): shows is keyof MuscleState => MUSCLE_STATES.some((state) => state === shows);
