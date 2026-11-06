import { DAY, ENERGY, INSULIN, REFERENCE } from "../../params";
import { intakeFlowsAt } from "../../engine/trajectory";
import { postureKcalPerHour } from "../../engine/anthropometrics";
import { foodsInStomach } from "../../whereabouts";
import { theFoods } from "../../words";
import {
  Context,
  POSTURE_WORD,
  ReadingSpec,
  Sample,
  always,
  causeOf,
  fixed,
  foodsNowArriving,
  glycogenShortfall,
  identity,
  nearestMinute,
  peaksAt,
  perHour,
  percentOf,
  reaches,
  rounded,
  startedBy,
  toMmol,
} from "../context";
import { EXPECTED, LOW, NORMAL, glucoseVerdict, insulinVerdict, quiet, triglycerideVerdict } from "../verdicts";

export const glucoseSpec: ReadingSpec = {
  label: "Blood sugar",
  organ: "pancreas",
  series: "glucose",
  unit: "mmol/L",
  toValue: toMmol,
  format: fixed(1),
  trendEpsilon: 1,
  headingChange: 2,
  range: (c) => {
    const r = REFERENCE.glucose;
    const band = c.phase === "fasting" ? r.fasting : r.afterMeal;
    return {
      ...r.scale,
      typicalLow: band.low,
      typicalHigh: band.high,
      typicalLabel: band.label,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (c, s) =>
    glucoseVerdict(s.value, {
      fasting: c.phase === "fasting",
      withinPeak: c.carbsPeaking,
      withinMeal: c.carbsActive,
      afterCarbs: c.afterCarbs,
    }),
  why: [
    [
      (c, s) => foodsNowArriving(c, "carbs").length > 0 && s.trend === "rising",
      (c) => `Sugar from ${theFoods(foodsNowArriving(c, "carbs"))} is arriving`,
    ],
    [
      (c, s) =>
        c.moving && (s.trend === "falling" || s.raw < c.tr.anthro.baselineGlucose - REFERENCE.glucose.nearBaselineMgDl),
      () => "Your moving muscles are pulling sugar out",
    ],
    [
      (c, s) => foodsNowArriving(c, "carbs").length > 0 && s.trend === "falling",
      () => "Insulin is moving sugar into muscle and liver",
    ],
    [(c) => foodsNowArriving(c, "carbs").length > 0, () => "Sugar arriving matches what your cells take"],
    [(c) => foodsInStomach(c.tr, c.t).length > 0, () => "Food hasn't reached your intestine yet"],
    [
      (c, s) =>
        s.raw < c.tr.anthro.baselineGlucose - REFERENCE.glucose.nearBaselineMgDl &&
        c.lastFood !== null &&
        c.t - c.lastFood.at < REFERENCE.fastingAfterMin,
      () => "A small dip after the meal",
    ],
    [
      (c, s) =>
        s.raw < c.tr.anthro.baselineGlucose - REFERENCE.glucose.nearBaselineMgDl &&
        c.v("liverGlycogen") < REFERENCE.liverGlycogen.low,
      () => "Your liver is running low on sugar",
    ],
    [
      (c, s) => s.raw < c.tr.anthro.baselineGlucose - REFERENCE.glucose.nearBaselineMgDl,
      () => "A small dip. Your liver is topping it up",
    ],
    [
      (c, s) =>
        s.raw > c.tr.anthro.baselineGlucose + REFERENCE.glucose.nearBaselineMgDl && startedBy("liverOutput", 0.03)(c),
      (c) => `Raised a little by ${causeOf(c, "liverOutput", 0.03) ?? ""}`,
    ],
    [
      (c, s) =>
        s.raw > c.tr.anthro.baselineGlucose + REFERENCE.glucose.nearBaselineMgDl &&
        startedBy("insulinSensitivity", 0.1)(c),
      (c) => `Slowed by ${causeOf(c, "insulinSensitivity", 0.1) ?? ""}`,
    ],
    [
      (c, s) => s.raw > c.tr.anthro.baselineGlucose + REFERENCE.glucose.nearBaselineMgDl,
      () => "Insulin is bringing it back down",
    ],
    [(c) => c.asleep, () => "Your liver feeds your blood while you sleep"],
    [
      always,
      (c) =>
        c.lastFood ? "Your liver is holding it steady between meals" : "Your liver is holding it steady from stores",
    ],
  ],
  forecast: [
    // Climbing back from a dip is a recovery, so only a rise above the resting level is a peak.
    peaksAt(
      2,
      (raw) => `Peaks at ${toMmol(raw).toFixed(1)}`,
      undefined,
      (c) => c.tr.anthro.baselineGlucose + REFERENCE.glucose.nearBaselineMgDl,
    ),
    reaches(
      (c, s) => Math.abs(s.raw - c.tr.anthro.baselineGlucose) > REFERENCE.glucose.nearBaselineMgDl,
      (raw, c) => Math.abs(raw - c.tr.anthro.baselineGlucose) <= REFERENCE.glucose.nearBaselineMgDl,
      (raw) => `Back to ${toMmol(raw).toFixed(1)}`,
    ),
  ],
};

const insulinRaised = (s: Sample) => s.value > REFERENCE.insulin.atRestBelowFold;

export const insulinSpec: ReadingSpec = {
  label: "Insulin",
  organ: "pancreas",
  series: "insulin",
  unit: "× rest",
  toValue: (raw) => raw / INSULIN.baselineUUPerMl,
  format: fixed(1),
  trendEpsilon: 0.4,
  headingChange: INSULIN.baselineUUPerMl * 0.3,
  range: (c) => {
    const r = REFERENCE.insulin;
    if (c.phase === "fasting") {
      const typicalLow = r.fastingUUPerMl.low / INSULIN.baselineUUPerMl;
      const typicalHigh = r.fastingUUPerMl.high / INSULIN.baselineUUPerMl;
      return {
        ...r.scale,
        typicalLow,
        typicalHigh,
        typicalLabel: `Under ${typicalHigh.toFixed(1)}× rest fasting`,
        evidence: r.fastingEvidence,
        source: r.fastingSource,
      };
    }
    return {
      ...r.scale,
      typicalLow: r.afterFoodTypicalFold.low,
      typicalHigh: r.afterFoodTypicalFold.high,
      typicalLabel: "Rises after food",
      evidence: r.afterFoodEvidence,
      source: r.afterFoodSource,
    };
  },
  judge: (c, s) => insulinVerdict(s.value, c.phase),
  why: [
    [(_c, s) => insulinRaised(s) && s.trend === "falling", () => "Sugar is easing, so your pancreas is easing off"],
    [(_c, s) => insulinRaised(s), () => "It's following the sugar"],
    [
      (c) => foodsNowArriving(c, "carbs").length > 0 || foodsInStomach(c.tr, c.t).length > 0,
      () => "Insulin rises as sugar arrives",
    ],
    [(_c, s) => s.value < REFERENCE.insulin.loweredBelowFold, () => "Lower after a long time without food"],
    [always, () => "At its resting level"],
  ],
  forecast: [
    peaksAt(INSULIN.baselineUUPerMl * 0.3, (raw) => `Peaks at ${(raw / INSULIN.baselineUUPerMl).toFixed(1)}×`),
    reaches(
      (_c, s) => insulinRaised(s),
      (raw) => raw / INSULIN.baselineUUPerMl <= REFERENCE.insulin.atRestBelowFold,
      () => "Back to rest",
    ),
  ],
};

function fatStillComingG(c: Context) {
  let grams = 0;
  for (const intake of c.eaten) {
    const flows = intakeFlowsAt(c.tr, intake.id, c.t);
    if (flows) grams += flows.stomachFat + flows.gutFat;
  }
  return grams;
}

const tgOverRest = (c: Context, s: Sample) => s.raw - c.tr.anthro.baselineTg;

export const triglycerideSpec: ReadingSpec = {
  label: "Blood fat",
  organ: "fat",
  series: "tg",
  unit: "mg/dL",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 3,
  range: (c) => {
    const r = REFERENCE.triglycerides;
    const fasting = c.phase === "fasting";
    return {
      ...r.scale,
      typicalLow: 0,
      typicalHigh: fasting ? r.fastingHigh : r.nonFastingHigh,
      typicalLabel: fasting
        ? `Under ${r.fastingHigh} mg/dL fasting`
        : `Under ${r.nonFastingHigh} mg/dL, higher for hours after fat`,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (c, s) => triglycerideVerdict(s.raw, { afterFattyMeal: c.afterFattyMeal, fasting: c.phase === "fasting" }),
  why: [
    [
      (c, s) =>
        tgOverRest(c, s) < REFERENCE.triglycerides.arrivedAboveRestMgDl &&
        fatStillComingG(c) >= REFERENCE.triglycerides.fatMealG,
      () => "The meal's fat hasn't arrived yet",
    ],
    [
      (c, s) => s.trend === "rising" && foodsNowArriving(c, "fat").length > 0,
      (c) => `Fat from ${theFoods(foodsNowArriving(c, "fat"))} is arriving`,
    ],
    [
      (c, s) => tgOverRest(c, s) >= REFERENCE.triglycerides.clearingAboveRestMgDl,
      () => "Your fat tissue is pulling meal fat out",
    ],
    [always, () => "No meal fat in your blood"],
  ],
  forecast: [
    peaksAt(3, (raw) => `Peaks at ${Math.round(raw)}`, DAY.minutes),
    reaches(
      (_c, s) => s.raw >= REFERENCE.triglycerides.fastingHigh,
      (raw) => raw < REFERENCE.triglycerides.fastingHigh,
      () => `Back under ${REFERENCE.triglycerides.fastingHigh}`,
    ),
  ],
};

const glycogenLow = (s: Sample) => s.value < REFERENCE.liverGlycogen.low;

export const glycogenSpec: ReadingSpec = {
  label: "Liver fuel",
  organ: "liver",
  series: "liverGlycogen",
  unit: "g",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.15,
  headingChange: 2,
  range: () => {
    const r = REFERENCE.liverGlycogen;
    return {
      ...r.scale,
      typicalLow: r.low,
      typicalHigh: r.high,
      typicalLabel: "Stored as glycogen: about 50 g after a night, 80 g after a meal",
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (_c, s) => (glycogenLow(s) ? LOW : NORMAL),
  why: [
    [(_c, s) => glycogenLow(s) && s.trend === "rising", (c) => `${glycogenShortfall(c)}. Refilling now`],
    [(_c, s) => glycogenLow(s), (c) => glycogenShortfall(c)],
    [
      (c, s) => s.trend === "rising" && foodsNowArriving(c, "carbs").length > 0,
      (c) => `Storing sugar from ${theFoods(foodsNowArriving(c, "carbs"))}`,
    ],
    [(_c, s) => s.trend === "rising", () => "Storing sugar after the meal"],
    [(c) => c.asleep, () => "Feeding your brain while you sleep"],
    [always, () => "Feeding your blood between meals"],
  ],
  forecast: [
    peaksAt(2, (raw) => `Refills to ${Math.round(raw)} g`),
    reaches(
      (_c, s) => !glycogenLow(s) && s.trend === "falling",
      (raw) => raw < REFERENCE.liverGlycogen.low,
      () => `Reaches ${REFERENCE.liverGlycogen.low} g`,
    ),
  ],
};

const muscleQuiet = (s: Sample) => s.value < REFERENCE.muscleUptake.quietBelowGPerH;

export const muscleUptakeSpec: ReadingSpec = {
  label: "Muscles taking sugar",
  organ: "muscle",
  series: "muscleUptakeGMin",
  unit: "g/h",
  toValue: perHour,
  format: rounded,
  trendEpsilon: 0.004,
  headingChange: 0.02,
  range: () => {
    const r = REFERENCE.muscleUptake;
    return {
      ...r.scale,
      typicalLow: 0,
      typicalHigh: r.highAtRestGPerH,
      typicalLabel: `Under ${r.highAtRestGPerH} g an hour at rest`,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (_c, s) => (muscleQuiet(s) ? quiet("Quiet") : EXPECTED),
  why: [
    [(c) => c.moving || c.training !== null, () => "Moving muscles pull sugar in with little insulin"],
    [(_c, s) => muscleQuiet(s), () => "Resting muscles take almost no sugar without insulin"],
    [(c) => c.posture === "sitting", () => "Insulin is opening them, slowly while you sit"],
    [always, () => "Insulin is opening them to sugar"],
  ],
  forecast: [peaksAt(0.02, (raw) => `Peaks at ${Math.round(perHour(raw))} g an hour`)],
};

const kcalAtMet = (c: Context, met: number) =>
  postureKcalPerHour(c.tr.anthro.bmrKcalPerDay, c.tr.scenario.body.weightKg, met);
const postureKcal = (c: Context) => kcalAtMet(c, ENERGY.mets[c.posture]);
const eventKcal = (c: Context) => postureKcal(c) * c.tr.channels.metabolism[nearestMinute(c)];
const digestingKcal = (c: Context, s: Sample) => s.raw - postureKcal(c) - eventKcal(c);

export const burnSpec: ReadingSpec = {
  label: "Energy burn",
  organ: "muscle",
  series: "kcalPerHour",
  unit: "kcal/h",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 5,
  range: (c) => {
    const r = REFERENCE.burn;
    const typicalLow = kcalAtMet(c, ENERGY.mets.sleeping);
    const typicalHigh = kcalAtMet(c, ENERGY.mets.standing);
    return {
      ...r.scale,
      typicalLow,
      typicalHigh,
      typicalLabel: `${Math.round(typicalLow)} to ${Math.round(typicalHigh)} kcal an hour at rest`,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (c, s) =>
    c.moving ||
    eventKcal(c) >= REFERENCE.burn.thermicNoticedKcal ||
    digestingKcal(c, s) >= REFERENCE.burn.thermicNoticedKcal
      ? EXPECTED
      : NORMAL,
  why: [
    [
      (c) => eventKcal(c) >= REFERENCE.burn.thermicNoticedKcal && startedBy("metabolism", 0.01)(c),
      (c) => `About ${Math.round(eventKcal(c))} kcal/h from ${causeOf(c, "metabolism", 0.01) ?? ""}`,
    ],
    [
      (c, s) => digestingKcal(c, s) >= REFERENCE.burn.thermicNoticedKcal,
      (c, s) =>
        `${POSTURE_WORD[c.posture]} burns about ${Math.round(postureKcal(c))} kcal an hour, digesting adds ${Math.round(digestingKcal(c, s))}`,
    ],
    [always, (c) => `${POSTURE_WORD[c.posture]} burns about ${Math.round(postureKcal(c))} kcal an hour`],
  ],
  forecast: [],
};

const FUEL_REST_PERCENT = ENERGY.carbFuelBase * 100;
const fuelTipped = (s: Sample) => s.value > FUEL_REST_PERCENT + 3;

export const fuelSpec: ReadingSpec = {
  label: "Burning sugar",
  organ: "muscle",
  series: "carbFuel",
  unit: "% of energy",
  toValue: percentOf,
  format: rounded,
  trendEpsilon: 0.005,
  headingChange: 0.03,
  range: () => {
    const r = REFERENCE.fuel;
    return {
      ...r.scale,
      typicalLow: r.low,
      typicalHigh: r.high,
      typicalLabel: `About ${r.low} to ${r.high}% at rest, the rest is fat`,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (_c, s) => (s.value > REFERENCE.fuel.high ? EXPECTED : NORMAL),
  why: [
    [(c) => c.training !== null, () => "Hard work runs mostly on sugar"],
    [(_c, s) => fuelTipped(s), () => "Insulin tips your cells toward burning sugar"],
    [always, () => "At rest you burn more fat than sugar"],
  ],
  forecast: [
    reaches(
      (_c, s) => fuelTipped(s),
      (raw) => raw * 100 <= FUEL_REST_PERCENT + 1,
      (raw) => `Back to ${Math.round(raw * 100)}%`,
    ),
  ],
};
