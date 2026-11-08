import { simulate } from "../src/model/engine/simulate";
import type { Trajectory } from "../src/model/engine/trajectory";
import { LABS } from "../src/model/params";
import type { ActivitySpan, Body, Intake, Labs, Scenario } from "../src/model/scenario";
import { hm, NO_NUTRIENTS } from "../src/model/testKit";

export const MG_DL_PER_MMOL = LABS.mgDlPerMmolGlucose;
export const RANGE_MMOL = { low: 3.9, high: 7.8 } as const;
export const FROM_MIN = hm(6);
export const TO_MIN = hm(24);
export const BREAKFAST_AT = hm(7, 45);
export const LUNCH_AT = hm(12, 30);
export const DINNER_AT = hm(19, 30);

const food = (id: string, label: string, at: number, parts: Partial<Intake>): Intake => ({
  ...NO_NUTRIENTS,
  id,
  label,
  at,
  ...parts,
});

// Every breakfast and meal below is a rough estimate from typical food tables, for a usual portion.
export const BREAKFASTS = [
  {
    id: "pain-blanc",
    label: "Pain blanc, confiture, jus d'orange",
    nutrients: { grams: 285, waterMl: 200, carbsG: 67, sugarG: 34, fatG: 1, proteinG: 7.5, fiberG: 2 },
  },
  {
    id: "porridge",
    label: "Porridge d'avoine, banane",
    nutrients: { grams: 350, waterMl: 260, carbsG: 66, sugarG: 22, fatG: 7, proteinG: 15, fiberG: 7.5 },
  },
  {
    id: "oeufs",
    label: "Œufs, pain complet, avocat",
    nutrients: { grams: 260, waterMl: 170, carbsG: 36, sugarG: 4, fatG: 26, proteinG: 20.5, fiberG: 10.5 },
  },
] as const;
export type BreakfastId = (typeof BREAKFASTS)[number]["id"];

const COFFEE = { grams: 250, waterMl: 250, caffeineMg: 95, liquid: true };
const LUNCH = { grams: 500, waterMl: 300, carbsG: 75, sugarG: 10, fatG: 20, proteinG: 30, fiberG: 7 };
const DINNER = { grams: 550, waterMl: 350, carbsG: 80, sugarG: 10, fatG: 25, proteinG: 35, fiberG: 8 };

export const PRESETS = {
  typique: {
    fastingGlucoseMmol: 5.0,
    fastingInsulinUuMl: 6,
    triglyceridesMmol: 1.0,
    hba1cPct: 5.3,
    ldlMmol: 2.8,
    hdlMmol: 1.4,
  },
  surveiller: {
    fastingGlucoseMmol: 6.1,
    fastingInsulinUuMl: 18,
    triglyceridesMmol: 2.0,
    hba1cPct: 6.0,
    ldlMmol: 4.1,
    hdlMmol: 0.9,
  },
} satisfies Record<string, Required<Labs>>;

export interface Inputs {
  body: Body;
  breakfast: BreakfastId;
  coffee: boolean;
}

const ACTIVITIES: ActivitySpan[] = [
  { from: 0, posture: "sleeping" },
  { from: hm(7, 30), posture: "sitting" },
];

export function scenarioOf({ body, breakfast, coffee }: Inputs): Scenario {
  const choice = BREAKFASTS.find((b) => b.id === breakfast) ?? BREAKFASTS[0];
  const intakes = [
    food("breakfast", choice.label, BREAKFAST_AT, choice.nutrients),
    ...(coffee ? [food("coffee", "Café", hm(8, 30), COFFEE)] : []),
    food("lunch", "Déjeuner", LUNCH_AT, LUNCH),
    food("dinner", "Dîner", DINNER_AT, DINNER),
  ];
  return { body, intakes, activities: ACTIVITIES, substances: [] };
}

export const homaOf = (labs: Labs) =>
  labs.fastingGlucoseMmol !== undefined && labs.fastingInsulinUuMl !== undefined
    ? (labs.fastingGlucoseMmol * labs.fastingInsulinUuMl) / LABS.homaDivisor
    : null;

export interface Peak {
  mmol: number;
  at: number;
}

export interface Run {
  trajectory: Trajectory;
  glucoseMmol: Float32Array; // one value per minute from 00:00
  breakfastPeak: Peak;
  insulinPeak: number; // µU/mL after breakfast
  minutesAbove: number; // between 06:00 and 24:00
  backNearFastingAt: number | null; // minute, or null when lunch comes first
}

// How close to the fasting level counts as back to normal.
const NEAR_FASTING_MMOL = 0.6;

function summarise(trajectory: Trajectory): Run {
  const glucoseMmol = Float32Array.from(trajectory.series.glucose, (mg) => mg / MG_DL_PER_MMOL);
  let peak: Peak = { mmol: -Infinity, at: BREAKFAST_AT };
  let insulinPeak = 0;
  for (let t = BREAKFAST_AT; t < LUNCH_AT; t++) {
    if (glucoseMmol[t] > peak.mmol) peak = { mmol: glucoseMmol[t], at: t };
    insulinPeak = Math.max(insulinPeak, trajectory.series.insulin[t]);
  }
  let minutesAbove = 0;
  for (let t = FROM_MIN; t <= TO_MIN; t++) if (glucoseMmol[t] > RANGE_MMOL.high) minutesAbove++;
  const near = trajectory.anthro.baselineGlucose / MG_DL_PER_MMOL + NEAR_FASTING_MMOL;
  let back: number | null = null;
  for (let t = peak.at; t < LUNCH_AT; t++) {
    if (glucoseMmol[t] <= near) {
      back = t;
      break;
    }
  }
  return { trajectory, glucoseMmol, breakfastPeak: peak, insulinPeak, minutesAbove, backNearFastingAt: back };
}

export function compare(inputs: Inputs): { typical: Run; yours: Run } {
  const { labs, ...bare } = inputs.body;
  const typical = summarise(simulate(scenarioOf({ ...inputs, body: bare })));
  const yours = summarise(simulate(scenarioOf(inputs)));
  return { typical, yours };
}

export const clock = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(Math.round(minute % 60)).padStart(2, "0")}`;
