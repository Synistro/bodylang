import { REFERENCE, STOMACH } from "../../params";
import { foodsInStomach } from "../../whereabouts";
import { forecast as stateForecast } from "../../forecast";
import { theFoods } from "../../words";
import {
  Context,
  ReadingSpec,
  Sample,
  always,
  foodsNowArriving,
  gramsPerHourFromMg,
  identity,
  near,
  peaksAt,
  perHour,
  reaches,
  rounded,
  tens,
} from "../context";
import { EXPECTED, quiet } from "../verdicts";

const stomachKcalText = (c: Context) => tens(c.v("stomachKcal"));

export const stomachSpec: ReadingSpec = {
  label: "Stomach",
  organ: "stomach",
  series: "stomachMl",
  unit: "ml",
  toValue: identity,
  format: tens,
  trendEpsilon: 2,
  headingChange: 20,
  range: (c) => {
    const r = REFERENCE.stomach;
    const fastingHigh = r.fastingHighMlPerKg * c.tr.scenario.body.weightKg;
    return {
      min: 0,
      max: STOMACH.fullnessMl,
      typicalLow: 0,
      typicalHigh: c.v("stomachKcal") > REFERENCE.stillDigestingKcal ? STOMACH.fullnessMl : fastingHigh,
      typicalLabel: `Under ${tens(fastingHigh)} ml empty, about 1 L after a meal`,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (_c, s) => {
    const r = REFERENCE.stomach;
    if (s.raw > r.veryFullMl) return { verdict: "raised", word: "Very full", tone: "note" };
    return s.raw <= STOMACH.restingVolumeMl + r.emptyAboveRestingMl ? quiet("Empty") : EXPECTED;
  },
  why: [
    [
      (c) => c.v("stomachKcal") > REFERENCE.stillDigestingKcal && c.v("emptyingKcalPerMin") <= 0.05,
      (c) => `Holding ${stomachKcalText(c)} kcal. The outlet opens in minutes`,
    ],
    [
      (c) => c.v("stomachKcal") > REFERENCE.stillDigestingKcal,
      (c) => `Holding ${stomachKcalText(c)} kcal from ${theFoods(foodsInStomach(c.tr, c.t))}`,
    ],
    [(_c, s) => s.raw <= STOMACH.restingVolumeMl + REFERENCE.stomach.emptyAboveRestingMl, () => "Empty and resting"],
    [always, () => "Passing liquid through"],
  ],
  forecast: [
    (c) => {
      const empties = stateForecast(c.tr, c.t).stomachEmpty;
      return empties === null ? null : near("Empty", empties);
    },
  ],
};

const absorbingQuiet = (s: Sample) => s.value < 0.5;
const fatCrossing = (c: Context) => perHour(c.v("fatAbsorbGMin")) >= REFERENCE.absorption.fatShownAboveGPerH;

export const absorbingSpec: ReadingSpec = {
  label: "Absorbing sugar",
  organ: "small_intestine",
  series: "carbAbsorbMgMin",
  unit: "g/h",
  toValue: gramsPerHourFromMg,
  format: rounded,
  trendEpsilon: 3,
  headingChange: 20,
  range: () => {
    const r = REFERENCE.absorption;
    return {
      ...r.scale,
      typicalLow: 0,
      typicalHigh: r.high,
      typicalLabel: `Up to about ${r.high} g an hour`,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (_c, s) => {
    if (s.value > REFERENCE.absorption.high) return { verdict: "raised", word: "Fast", tone: "note" };
    return absorbingQuiet(s) ? quiet("Quiet") : EXPECTED;
  },
  why: [
    [
      (c, s) => !absorbingQuiet(s) && foodsNowArriving(c, "carbs").length > 0,
      (c) => `Absorbing sugar from ${theFoods(foodsNowArriving(c, "carbs"))}`,
    ],
    [(c) => fatCrossing(c), () => "The sugar has crossed. Fat is still crossing"],
    [(c) => foodsInStomach(c.tr, c.t).length > 0, () => "Food hasn't reached your intestine yet"],
    [always, () => "Nothing to absorb right now"],
  ],
  forecast: [
    peaksAt(20, (raw) => `Peaks at ${Math.round(gramsPerHourFromMg(raw))} g an hour`),
    reaches(
      (_c, s) => !absorbingQuiet(s),
      (raw) => gramsPerHourFromMg(raw) < 0.5,
      () => "Finishes",
    ),
  ],
};
