import { maxHeartRate } from "../../events/muscles";
import { BLOOD_FLOW, HEART, PROCESS, REFERENCE, RESTING_SYSTOLIC_MMHG } from "../../params";
import { POSTURES } from "../../scenario";
import { OrganId } from "../../ids";
import { Context, ForecastRule, ReadingSpec, ReasonRow, Sample, always, causedBy, digesting, firstWhen, fixed, fromMoving, heartCauses, heartReason, identity, movedWord, near, ownRestBpm, percentOf, reaches, rounded, topCause } from "../context";
import { EXPECTED, HIGH, LOW, NORMAL, SLIGHTLY_RAISED, heartVerdict, unpainted } from "../verdicts";

// One row per share of the blood. They read alike, so one builder makes all four.
export function bloodShareSpec(id: "flowGut" | "flowMuscle" | "flowBrain" | "flowKidneys", label: string, organ: OrganId, band: { low: number; high: number; max: number }, why: readonly ReasonRow[], forecast: readonly ForecastRule[] = []): ReadingSpec {
  const r = REFERENCE.bloodFlow;
  return {
    label,
    organ,
    series: id,
    unit: "% of blood",
    toValue: percentOf,
    format: rounded,
    trendEpsilon: 0.002,
    headingChange: 0.015,
    range: () => ({ min: 0, max: band.max, typicalLow: band.low, typicalHigh: band.high, typicalLabel: `${band.low} to ${band.high}% at rest`, evidence: r.evidence, source: r.source }),
    judge: (c, s) => ((s.value < band.low || s.value > band.high) && (digesting(c) || c.moving || c.exerting || c.v("stressLevel") >= 0.1) ? EXPECTED : NORMAL),
    why,
    forecast,
  };
}

export const heartSpec: ReadingSpec = {
  label: "Heart rate",
  organ: "heart",
  series: "hr",
  unit: "bpm",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 2,
  range: () => {
    const r = REFERENCE.heart;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} bpm at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => heartVerdict(s.raw, { exerting: c.exerting || c.moving, asleep: c.asleep, ownRestBpm: ownRestBpm(c), explainedBpm: heartCauses(c).reduce((sum, cause) => sum + cause.bpm, 0), maxBpm: maxHeartRate(c.tr.scenario.body.age) }),
  why: [
    [(c) => heartReason(c) !== null, (c) => heartReason(c) ?? ""],
    [(c) => c.asleep, () => "Your heart slows while you sleep"],
    [always, () => "Your usual rate at rest"],
  ],
  forecast: [
    (c, s) => {
      if (s.raw - ownRestBpm(c) < 2) return null;
      const at = firstWhen(c, (m) => c.tr.series.hr[m] - ownRestBpm(c, POSTURES[Math.round(c.tr.series.posture[m])]) < 1.5);
      return at === null ? null : near(`Back to ${Math.round(c.tr.series.hr[at])}`, at);
    },
  ],
};

const outputRaised = (c: Context, s: Sample) => s.raw - (ownRestBpm(c) * s.raw) / c.v("hr") >= REFERENCE.cardiacOutput.raisedAboveOwnRestL;

export const outputSpec: ReadingSpec = {
  label: "Heart output",
  organ: "heart",
  series: "cardiacOutput",
  unit: "L/min",
  toValue: identity,
  format: fixed(1),
  trendEpsilon: 0.05,
  headingChange: 0.2,
  range: (c) => {
    const r = REFERENCE.cardiacOutput;
    const band = c.tr.scenario.body.sex === "male" ? r.male : r.female;
    return { ...r.scale, typicalLow: band.low, typicalHigh: band.high, typicalLabel: `${band.low} to ${band.high} L/min at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.cardiacOutput;
    const band = c.tr.scenario.body.sex === "male" ? r.male : r.female;
    if (c.moving || c.exerting) return EXPECTED;
    if (s.raw > band.high) return SLIGHTLY_RAISED;
    return outputRaised(c, s) ? EXPECTED : NORMAL;
  },
  why: [
    [(c) => c.moving || c.training !== null, () => "Your muscles need more blood"],
    causedBy("heartRate", 3, (cause) => `Working harder because of ${cause}`),
    [(c, s) => outputRaised(c, s), () => "Your heart beats faster to feed the gut"],
    [always, () => "Your usual output at rest"],
  ],
  forecast: [],
};

export const breathingSpec: ReadingSpec = {
  label: "Breathing",
  organ: "lungs",
  series: "breaths",
  unit: "a minute",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.2,
  headingChange: 1,
  range: () => {
    const r = REFERENCE.breathing;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} a minute at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.breathing;
    if (c.moving || c.exerting) return EXPECTED;
    if (s.raw > r.high) return SLIGHTLY_RAISED;
    return s.raw < r.low && !c.asleep ? unpainted(LOW) : NORMAL;
  },
  why: [
    [(c) => c.moving || c.training !== null, () => "Your muscles need more oxygen"],
    causedBy("breathing", 1, (cause) => `Faster because of ${cause}`),
    [(c) => c.asleep, () => "You breathe slower asleep"],
    [(c, s) => s.raw - HEART.breathsByActivity[c.posture] >= 0.5, () => "Digesting uses extra oxygen"],
    [always, () => "Your usual rate at rest"],
  ],
  forecast: [],
};

export const flowLitres = (c: Context, s: Sample) => (s.raw * c.v("cardiacOutput")).toFixed(1);
const gutPulled = (s: Sample) => s.value > REFERENCE.bloodFlow.digestingAbovePercent;

export const gutShareSpec = bloodShareSpec(
  "flowGut",
  "Blood to gut",
  "small_intestine",
  REFERENCE.bloodFlow.gut,
  [
    [(c) => c.moving || c.training !== null, () => "Your working muscles are taking the blood"],
    [(_c, s) => gutPulled(s), () => "Digestion pulls more blood to your gut"],
    [always, () => "Its usual share at rest"],
  ],
  [
    reaches(
      (_c, s) => gutPulled(s),
      (raw) => raw <= BLOOD_FLOW.rest.gut + 0.01,
      (raw) => `Back to ${Math.round(raw * 100)}%`,
    ),
  ],
);

const pressureCauses = (c: Context) => topCause(c, "bloodPressure", 3);

export const bloodPressureSpec: ReadingSpec = {
  label: "Blood pressure",
  organ: "heart",
  series: "systolic",
  unit: "mmHg",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 5,
  range: () => {
    const r = REFERENCE.bloodPressure;
    return { ...r.scale, typicalLow: r.typicalLow, typicalHigh: r.high, typicalLabel: `Under ${r.high} mmHg at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.bloodPressure;
    if (c.exerting || c.moving || fromMoving(c, "bloodPressure") >= PROCESS.movingNamedFromMmHg) return EXPECTED;
    if (s.value >= r.danger) return HIGH;
    if (s.value >= r.raised) return { verdict: "raised", word: "Raised", tone: "note" };
    return s.value >= r.high ? unpainted(SLIGHTLY_RAISED) : NORMAL;
  },
  why: [
    [(c) => fromMoving(c, "bloodPressure") >= PROCESS.movingNamedFromMmHg, (c) => `About ${Math.round(fromMoving(c, "bloodPressure"))} mmHg from ${movedWord(c)}`],
    [(c) => pressureCauses(c) !== null, (c, s) => `About ${Math.round(s.raw - RESTING_SYSTOLIC_MMHG)} mmHg from ${pressureCauses(c)?.causeName ?? ""}`],
    [always, () => "My estimate of your resting pressure"],
  ],
  forecast: [],
};
