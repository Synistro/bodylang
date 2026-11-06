import { KCAL_PER_G } from "../params";
import { CustomSubstance, Intake, kcalOf } from "../scenario";
import { FLOW_SIZE, LEDGER_SIZE } from "./trajectory";

// One thing eaten, followed through the body.
export interface IntakeTrack {
  intake: Intake;
  kcal: number;
  stomachCarb: number;
  stomachFat: number;
  stomachProtein: number;
  stomachFiber: number;
  stomachLiquid: number;
  stomachCaffeine: number;
  stomachAlcohol: number;
  gutCarb: number;
  gutFat: number;
  gutProtein: number;
  gutCaffeine: number;
  gutAlcohol: number;
  bloodGlucoseG: number;
  bloodFatG: number;
  bloodAminoG: number;
  dest: { liver: number; muscle: number; fat: number; burned: number; colon: number };
  ledger: Float32Array; // LEDGER_SIZE per minute
  caffeineLedger: Float32Array; // stomach, gut, body, cleared per minute
  caffeineBody: number;
  caffeineCleared: number;
  flows: Float32Array; // FLOW_SIZE per minute
  carbsAbsorbedPerMin: number;
  fatAbsorbedPerMin: number;
  fatCleared: number;
  alcoholAbsorbed: number;
}

export interface SubstanceTrack {
  substance: CustomSubstance;
  gut: number;
  body: number;
  cleared: number;
  series: Float32Array; // mg/L per minute
  ledger: Float32Array; // gut, body, cleared per minute
}

export const newIntakeTrack = (intake: Intake, minutes: number): IntakeTrack => ({
  intake,
  kcal: kcalOf(intake),
  stomachCarb: 0,
  stomachFat: 0,
  stomachProtein: 0,
  stomachFiber: 0,
  stomachLiquid: 0,
  stomachCaffeine: 0,
  stomachAlcohol: 0,
  gutCarb: 0,
  gutFat: 0,
  gutProtein: 0,
  gutCaffeine: 0,
  gutAlcohol: 0,
  bloodGlucoseG: 0,
  bloodFatG: 0,
  bloodAminoG: 0,
  dest: { liver: 0, muscle: 0, fat: 0, burned: 0, colon: 0 },
  ledger: new Float32Array(minutes * LEDGER_SIZE),
  caffeineLedger: new Float32Array(minutes * 4),
  caffeineBody: 0,
  caffeineCleared: 0,
  flows: new Float32Array(minutes * FLOW_SIZE),
  carbsAbsorbedPerMin: 0,
  fatAbsorbedPerMin: 0,
  fatCleared: 0,
  alcoholAbsorbed: 0,
});

export const newSubstanceTrack = (substance: CustomSubstance, minutes: number): SubstanceTrack => ({
  substance,
  gut: 0,
  body: 0,
  cleared: 0,
  series: new Float32Array(minutes),
  ledger: new Float32Array(minutes * 3),
});

const { carb: CARB, protein: PROTEIN_KCAL, fat: FAT } = KCAL_PER_G;

export const stomachKcalOf = (k: IntakeTrack) =>
  k.stomachCarb * CARB + k.stomachFat * FAT + k.stomachProtein * PROTEIN_KCAL;
export const gutKcalOf = (k: IntakeTrack) => k.gutCarb * CARB + k.gutFat * FAT + k.gutProtein * PROTEIN_KCAL;
export const bloodKcalOf = (k: IntakeTrack) =>
  k.bloodGlucoseG * CARB + k.bloodFatG * FAT + k.bloodAminoG * PROTEIN_KCAL;

export const heldInGutKcal = (tracks: IntakeTrack[]) =>
  tracks.reduce((sum, k) => sum + stomachKcalOf(k) + gutKcalOf(k), 0);
