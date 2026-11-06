import type { Cycle } from "../cycle";
import type { BodyEvent, ChannelId, ResolvedEvent } from "../events";
import { DAY } from "../params";
import type { CustomSubstance, Scenario } from "../scenario";
import { alcoholVolumeL, type Anthropometrics } from "./anthropometrics";

export const SERIES = [
  "glucose",
  "insulin",
  "tg",
  "caffeine",
  "occupancy",
  "alcohol",
  "hr",
  "breaths",
  "cardiacOutput",
  "flowBrain",
  "flowKidneys",
  "flowGut",
  "flowMuscle",
  "stomachMl",
  "stomachKcal",
  "gutKcal",
  "emptyingKcalPerMin",
  "glucoseAbsorbMgMin", // past the liver, which is what moves blood sugar
  "carbAbsorbMgMin", // all of it crossing the gut wall, which is what the gut's limit is about
  "fatAbsorbGMin",
  "proteinAbsorbGMin",
  "insulinSecretion",
  "liverGlycogen",
  "muscleGlycogen",
  "fatStoredG",
  "bladderMl",
  "kcalPerHour",
  "carbFuel",
  "fullness",
  "alertness",
  "drowsy",
  "jitter",
  "hunger",
  "crash",
  "muscleUptakeGMin", // all of it, whatever moved it
  "insulinUptakeGMin", // what insulin moved out of the blood, wherever it went
  "hepaticOutputGMin",
  "liverUptakeGMin",
  "posture",
  "digestion",
  "mealDip",
  "sleepPressure",
  "hoursAwake",
  "caffeineFelt", // how much a dose is felt; "occupancy" is the share of receptors blocked
  "temperature",
  "stressLevel",
  "inflammation",
  "immune",
  "reward",
  "fluidBalance",
  "systolic",
  "muscleWork",
  "cycleDay",
  "estradiol",
  "progesterone",
  "lh",
] as const;

export type SeriesName = (typeof SERIES)[number];

// Where one thing you ate currently is. Each number is kcal, or mg for a drug-like intake.
export interface Ledger {
  stomach: number;
  intestine: number;
  blood: number;
  liver: number;
  muscle: number;
  fat: number;
  burned: number;
  colon: number;
}

export const LEDGER_KEYS = ["stomach", "intestine", "blood", "liver", "muscle", "fat", "burned", "colon"] as const;
export const LEDGER_SIZE = LEDGER_KEYS.length;

// What one intake is doing at one minute, in grams: where its fat is, what is crossing the gut
// wall this minute, and where its alcohol has got to.
export interface IntakeFlows {
  stomachFat: number;
  gutFat: number;
  bloodFat: number;
  fatCleared: number;
  carbsAbsorbedPerMin: number;
  fatAbsorbedPerMin: number;
  stomachAlcohol: number;
  gutAlcohol: number;
  alcoholAbsorbed: number;
}

const FLOW_KEYS = ["stomachFat", "gutFat", "bloodFat", "fatCleared", "carbsAbsorbedPerMin", "fatAbsorbedPerMin", "stomachAlcohol", "gutAlcohol", "alcoholAbsorbed"] as const;
export const FLOW_SIZE = FLOW_KEYS.length;

export interface Trajectory {
  scenario: Scenario;
  anthro: Anthropometrics;
  series: Record<SeriesName, Float32Array>;
  intakeLedgers: Map<string, { ledger: Float32Array; caffeineMg: number; caffeineLedger: Float32Array; flows: Float32Array; alcoholG: number }>;
  substances: Map<string, { series: Float32Array; ledger: Float32Array; substance: CustomSubstance }>;
  events: ResolvedEvent[];
  channels: Record<ChannelId, Float32Array>;
  // Everything that works muscle: logged events, and runs from the activity list. Read muscle state from this.
  muscleEvents: BodyEvent[];
  cycle: Cycle | null;
}

export function value(tr: Trajectory, name: SeriesName, minute: number): number {
  const s = tr.series[name];
  const t = Math.max(0, Math.min(s.length - 1, minute));
  const a = Math.floor(t);
  const b = Math.min(s.length - 1, a + 1);
  return s[a] + (s[b] - s[a]) * (t - a);
}

export function ledgerAt(tr: Trajectory, intakeId: string, minute: number): Ledger | null {
  const l = tr.intakeLedgers.get(intakeId);
  if (!l) return null;
  const a = Math.max(0, Math.min(DAY.minutes, Math.floor(minute))) * LEDGER_SIZE;
  return {
    stomach: l.ledger[a],
    intestine: l.ledger[a + 1],
    blood: l.ledger[a + 2],
    liver: l.ledger[a + 3],
    muscle: l.ledger[a + 4],
    fat: l.ledger[a + 5],
    burned: l.ledger[a + 6],
    colon: l.ledger[a + 7],
  };
}

export function caffeineLedgerAt(tr: Trajectory, intakeId: string, minute: number) {
  const l = tr.intakeLedgers.get(intakeId);
  if (!l || l.caffeineMg <= 0) return null;
  const a = Math.max(0, Math.min(DAY.minutes, Math.floor(minute))) * 4;
  return { stomach: l.caffeineLedger[a], intestine: l.caffeineLedger[a + 1], blood: l.caffeineLedger[a + 2], cleared: l.caffeineLedger[a + 3], dose: l.caffeineMg };
}

export function intakeFlowsAt(tr: Trajectory, intakeId: string, minute: number): IntakeFlows | null {
  const l = tr.intakeLedgers.get(intakeId);
  if (!l) return null;
  const a = Math.max(0, Math.min(DAY.minutes, Math.floor(minute))) * FLOW_SIZE;
  return {
    stomachFat: l.flows[a],
    gutFat: l.flows[a + 1],
    bloodFat: l.flows[a + 2],
    fatCleared: l.flows[a + 3],
    carbsAbsorbedPerMin: l.flows[a + 4],
    fatAbsorbedPerMin: l.flows[a + 5],
    stomachAlcohol: l.flows[a + 6],
    gutAlcohol: l.flows[a + 7],
    alcoholAbsorbed: l.flows[a + 8],
  };
}

// Alcohol pools once it reaches the blood, so what is left is split in proportion to what each
// drink contributed.
export function alcoholLedgerAt(tr: Trajectory, intakeId: string, minute: number) {
  const l = tr.intakeLedgers.get(intakeId);
  const own = intakeFlowsAt(tr, intakeId, minute);
  if (!l || !own || l.alcoholG <= 0) return null;
  let absorbedByAll = 0;
  for (const id of tr.intakeLedgers.keys()) absorbedByAll += intakeFlowsAt(tr, id, minute)?.alcoholAbsorbed ?? 0;
  const inBody = value(tr, "alcohol", Math.floor(minute)) * alcoholVolumeL(tr.scenario.body);
  const blood = absorbedByAll > 0 ? own.alcoholAbsorbed * Math.min(1, inBody / absorbedByAll) : 0;
  return { stomach: own.stomachAlcohol, intestine: own.gutAlcohol, blood, cleared: own.alcoholAbsorbed - blood, dose: l.alcoholG };
}

export function substanceLedgerAt(tr: Trajectory, substanceId: string, minute: number) {
  const s = tr.substances.get(substanceId);
  if (!s) return null;
  const a = Math.max(0, Math.min(DAY.minutes, Math.floor(minute))) * 3;
  return { gut: s.ledger[a], body: s.ledger[a + 1], cleared: s.ledger[a + 2] };
}
