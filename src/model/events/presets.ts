import { MUSCLE_LABEL } from "../muscleGroups";
import { ACTIVITY, DAY, ENERGY, HEART, ILLNESS, MUSCLE_RECOVERY, POOR_SLEEP, RESTING_SYSTOLIC_MMHG, SEX, STRESS, TRAINING } from "../params";
import type { ActivitySpan, Body } from "../scenario";
import type { Anthropometrics } from "../engine/anthropometrics";
import { endOf, hours, maxHeartRate, namesOf } from "./muscles";
import { ActivityBout, BodyEvent, Effect, EventFeeling, EventStop, ResolvedEvent, SEX_LABEL, Symptom } from "./types";
import type { ReadingId, ThreadKind } from "../ids";
import type { Preset } from "./types";

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

// What the rest of the model needs to know about each preset, in one place.
export const PRESET_FACTS: Record<Preset, { threadKind: ThreadKind; chartReadings: readonly ReadingId[] | null }> = {
  training: { threadKind: "training", chartReadings: null }, // its chart is the muscles it worked
  illness: { threadKind: "illness", chartReadings: ["temperature", "inflammation", "immune"] },
  sex: { threadKind: "other", chartReadings: ["hr", "reward"] },
  stress: { threadKind: "other", chartReadings: ["stressLevel", "hr", "bloodPressure"] },
  poor_sleep: { threadKind: "other", chartReadings: ["alertness"] },
  custom: { threadKind: "other", chartReadings: null },
};
