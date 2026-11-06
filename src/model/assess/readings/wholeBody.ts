import { cyclePhase, CyclePhase, minutesToNextPeriod } from "../../cycle";
import { CYCLE, Evidence, KIDNEY, PROCESS, REFERENCE } from "../../params";
import { SeriesName } from "../../engine/trajectory";
import { OrganId } from "../../ids";
import { levelWord } from "../../words";
import { Context, ReadingSpec, ReasonRow, Said, Sample, always, causedBy, fixed, fromCycle, fromMoving, identity, movedWord, near, nextVoid, percentOf, raises, reaches, rounded, startedBy, tens } from "../context";
import { Judgement } from "../types";
import { EXPECTED, HIGH, LOW, NORMAL, SLIGHTLY_RAISED, quiet, unpainted } from "../verdicts";

export const bladderSpec: ReadingSpec = {
  label: "Bladder",
  organ: "bladder",
  series: "bladderMl",
  unit: "ml",
  toValue: identity,
  format: tens,
  trendEpsilon: 1,
  headingChange: null,
  range: () => {
    const r = REFERENCE.bladder;
    return { min: 0, max: r.capacityMl, typicalLow: 0, typicalHigh: r.strongDesireMl, typicalLabel: `You notice it near ${r.firstDesireMl} ml, urgent near ${r.strongDesireMl} ml`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.bladder;
    if (c.asleep && s.raw >= r.strongDesireMl) return { ...EXPECTED, word: "Full by morning" };
    return s.raw >= r.firstDesireMl ? quiet("Filling") : NORMAL;
  },
  why: [
    [(c) => c.asleep, () => "Your kidneys fill it while you sleep"],
    [always, () => `Your kidneys add at least ${Math.round(KIDNEY.urineMlPerMin * 60)} ml an hour`],
  ],
  forecast: [
    (c) => {
      const at = nextVoid(c);
      return at === null ? null : near("You'll want to go", at);
    },
  ],
};

// Scales from 0 to 100 that only move when something pushes them.
function eventScaleSpec(label: string, organ: OrganId, series: SeriesName, band: { high: number; evidence: Evidence; source: string }, why: readonly ReasonRow[], judge: (c: Context, s: Sample) => Judgement): ReadingSpec {
  return {
    label,
    organ,
    series,
    unit: "",
    toValue: percentOf,
    format: (x) => levelWord(x / 100),
    trendEpsilon: 0.003,
    headingChange: 0.05,
    range: () => ({ min: 0, max: 100, typicalLow: 0, typicalHigh: band.high, typicalLabel: band.high < 100 ? "Quiet at rest" : "Rises with what you do", evidence: band.evidence, source: band.source }),
    judge,
    why,
    forecast: [reaches((_c, s) => s.value >= 5, (raw) => raw * 100 < 5, () => "Settles")],
  };
}

const isIll = (c: Context) => c.events.some((e) => e.preset === "illness");

const coolingDown = (c: Context) => !c.moving && fromMoving(c, "temperature") >= PROCESS.coolingNamedFromC;

export const temperatureSpec: ReadingSpec = {
  label: "Temperature",
  organ: "brain",
  series: "temperature",
  unit: "°C",
  toValue: identity,
  format: fixed(1),
  trendEpsilon: 0.02,
  headingChange: 0.3,
  range: () => {
    const r = REFERENCE.temperature;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} °C at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.temperature;
    if (s.value >= r.dangerC) return HIGH;
    if (s.value < r.low) return unpainted(LOW);
    if (s.value <= r.high) return NORMAL;
    if (c.moving || c.exerting || coolingDown(c)) return EXPECTED;
    return s.value >= r.feverC ? { verdict: "raised", word: "Fever", tone: "note" } : unpainted(SLIGHTLY_RAISED);
  },
  why: [
    [(c) => c.training !== null || c.moving, () => "Working muscles make heat"],
    [coolingDown, (c) => `Cooling down after ${movedWord(c)}`],
    [(c) => isIll(c) && startedBy("temperature", 0.2)(c), () => "Your immune system turned up your temperature"],
    causedBy("temperature", 0.2, raises),
    [(c) => fromCycle(c, "temperature") >= CYCLE.namedFrom.warmthC, () => "A little warmer in this part of your cycle"],
    [always, () => "Your usual daily rhythm"],
  ],
  forecast: [
    reaches(
      (_c, s) => s.value > REFERENCE.temperature.high,
      (raw) => raw <= REFERENCE.temperature.high,
      () => `Back under ${REFERENCE.temperature.high}`,
    ),
  ],
};

export const stressSpec = eventScaleSpec(
  "Stress",
  "brain",
  "stressLevel",
  REFERENCE.stressLevel,
  [causedBy("stress", 0.02, raises), [always, () => "No stress signal right now"]],
  (c, s) => {
    if (s.value < REFERENCE.stressLevel.high) return NORMAL;
    return c.exerting ? EXPECTED : { verdict: "raised", word: "Raised", tone: "calm" };
  },
);

export const inflammationSpec = eventScaleSpec(
  "Inflammation",
  "spleen",
  "inflammation",
  REFERENCE.inflammation,
  [causedBy("inflammation", 0.02, raises), [always, () => "No inflammation signal right now"]],
  (_c, s) => (s.value < REFERENCE.inflammation.high ? NORMAL : EXPECTED),
);

export const immuneSpec = eventScaleSpec(
  "Immune response",
  "spleen",
  "immune",
  REFERENCE.immune,
  [causedBy("immune", 0.02, (cause) => `Working against ${cause}`), [always, () => "Patrolling as usual"]],
  (_c, s) => (s.value < REFERENCE.immune.high ? NORMAL : EXPECTED),
);

export const PHASE_WORD: Record<CyclePhase, string> = { period: "Period", follicular: "Follicular phase", ovulation: "Around ovulation", luteal: "Luteal phase" };
export const phaseOf = (c: Context): CyclePhase | null => (c.tr.cycle ? cyclePhase(c.tr.cycle, c.t) : null);

export const PHASE_SAYS: Record<CyclePhase, { day: string; estradiol: string; progesterone: string }> = {
  period: { day: "The lining of the uterus is shedding", estradiol: "Low, and starting to rise as a follicle grows", progesterone: "Low, which is what started the period" },
  follicular: { day: "An egg is ripening and the lining is rebuilding", estradiol: "Rising, because a follicle in the ovary is growing", progesterone: "Low until an egg is released" },
  ovulation: { day: "A surge of LH releases an egg about now", estradiol: "At its peak, which triggers the LH surge", progesterone: "Just starting to rise" },
  luteal: { day: "The lining stays ready, and your body runs slightly warmer", estradiol: "A second, smaller rise from the empty follicle", progesterone: "High, made by the empty follicle" },
};

const nextPeriod = (c: Context): Said | null => {
  if (!c.tr.cycle) return null;
  const days = Math.round(minutesToNextPeriod(c.tr.cycle, c.t) / 1440);
  const text = days <= 1 ? "Next period about tomorrow" : `Next period in about ${days} days`;
  return { text, short: `Period in ${days} d`, at: null };
};

export const cycleDaySpec: ReadingSpec = {
  label: "Cycle day",
  organ: "uterus",
  series: "cycleDay",
  unit: "day",
  toValue: identity,
  format: rounded,
  trendEpsilon: 2,
  headingChange: null,
  range: (c) => {
    const length = c.tr.cycle?.lengthDays ?? CYCLE.lengthDays;
    return { min: 1, max: length, typicalLow: 1, typicalHigh: length, typicalLabel: `Of a ${length}-day cycle`, evidence: CYCLE.evidence, source: CYCLE.source };
  },
  judge: (c) => quiet(PHASE_WORD[phaseOf(c) ?? "follicular"]),
  why: [[always, (c) => PHASE_SAYS[phaseOf(c) ?? "follicular"].day]],
  forecast: [(c) => nextPeriod(c)],
};

const hormoneSpec = (label: string, organ: OrganId, series: "estradiol" | "progesterone", unit: string, digits: number, says: "estradiol" | "progesterone"): ReadingSpec => ({
  label,
  organ,
  series,
  unit,
  toValue: identity,
  format: (x) => x.toFixed(digits),
  trendEpsilon: series === "estradiol" ? 2 : 0.05,
  headingChange: null,
  range: () => {
    const r = CYCLE.scale[says];
    return { min: r.min, max: r.max, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} ${unit} across a cycle`, evidence: CYCLE.evidence, source: CYCLE.source };
  },
  judge: (c) => quiet(PHASE_WORD[phaseOf(c) ?? "follicular"]),
  why: [[always, (c) => PHASE_SAYS[phaseOf(c) ?? "follicular"][says]]],
  forecast: [],
});

export const estradiolSpec = hormoneSpec("Estrogen", "ovaries", "estradiol", "pmol/L", 0, "estradiol");
export const progesteroneSpec = hormoneSpec("Progesterone", "ovaries", "progesterone", "nmol/L", 1, "progesterone");

export const rewardSpec = eventScaleSpec("Feel-good chemicals", "brain", "reward", REFERENCE.reward, [causedBy("reward", 0.02, raises), [always, () => "At their usual level"]], () => NORMAL);

const fluidLitresPerPercent = (c: Context, share: number) => (c.tr.scenario.body.weightKg * share * 1000) / 1000;
const fluidLost = (s: Sample) => s.value < -0.05;

export const fluidSpec: ReadingSpec = {
  label: "Fluid",
  organ: "kidneys",
  series: "fluidBalance",
  unit: "L",
  toValue: (raw) => raw / 1000,
  format: (x) => (x <= -0.05 ? `−${Math.abs(x).toFixed(1)}` : "0.0"),
  trendEpsilon: 2,
  headingChange: 100,
  range: (c) => {
    const r = REFERENCE.fluid;
    const typicalLow = -fluidLitresPerPercent(c, r.noticeableShareOfWeight);
    return { min: -fluidLitresPerPercent(c, r.impairingShareOfWeight * 2), max: 0.2, typicalLow, typicalHigh: 0.1, typicalLabel: `Within ${Math.abs(typicalLow).toFixed(1)} L of even`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.fluid;
    if (s.value <= -fluidLitresPerPercent(c, r.impairingShareOfWeight)) return { ...LOW, word: "Dry" };
    return s.value <= -fluidLitresPerPercent(c, r.noticeableShareOfWeight) ? { ...unpainted(LOW), word: "A little dry" } : NORMAL;
  },
  why: [
    [(c) => c.moving || c.training !== null, () => "Lost through sweat and breath"],
    causedBy("fluidLoss", 0.5, (cause) => `Lost to ${cause}`),
    [(_c, s) => fluidLost(s), () => "You haven't drunk it back yet"],
    [always, () => "Nothing extra lost"],
  ],
  forecast: [],
};
