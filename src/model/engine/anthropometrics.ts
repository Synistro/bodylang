import { ALCOHOL, BODY_COMPOSITION, CAFFEINE, GLUCOSE, HEART, INSULIN, LIPID, MUSCLE } from "../params";
import type { Body } from "../scenario";

export interface Anthropometrics {
  bmi: number;
  leanKg: number;
  bloodVolumeL: number;
  bmrKcalPerDay: number;
  restingBpm: number;
  caffeineHalfLifeH: number;
  sensitivity: number;
  baselineGlucose: number;
  baselineTg: number;
  muscleGlycogenMaxG: number;
}

export function anthropometrics(b: Body): Anthropometrics {
  const hM = b.heightCm / 100;
  const bmi = b.weightKg / (hM * hM);
  const male = b.sex === "male";
  const leanKg = Math.min(
    BODY_COMPOSITION.maxLeanShare * b.weightKg,
    male ? 0.407 * b.weightKg + 0.267 * b.heightCm - 19.2 : 0.252 * b.weightKg + 0.473 * b.heightCm - 48.3,
  );
  const bloodVolumeL = male
    ? 0.3669 * hM ** 3 + 0.03219 * b.weightKg + 0.6041
    : 0.3561 * hM ** 3 + 0.03308 * b.weightKg + 0.1833;
  const bmrKcalPerDay = 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age + (male ? 5 : -161);
  const restingBpm = (male ? HEART.restBpmMale : HEART.restBpmFemale) + HEART.bmiGain * Math.max(0, bmi - 24);
  const sensitivity =
    INSULIN.sensitivity *
    (INSULIN.sensitivityRefBmi / Math.max(bmi, 18)) ** INSULIN.sensitivityBmiPower *
    (1 - INSULIN.sensitivityAgeLoss * Math.max(0, b.age - 30)) *
    (male ? 1 : INSULIN.femaleBonus);
  return {
    bmi,
    leanKg,
    bloodVolumeL,
    bmrKcalPerDay,
    restingBpm,
    caffeineHalfLifeH: CAFFEINE.halfLifeH.mid,
    sensitivity,
    baselineGlucose:
      GLUCOSE.baselineMgDl +
      GLUCOSE.baselineAgeGain * Math.max(0, b.age - 40) +
      GLUCOSE.baselineBmiGain * Math.max(0, bmi - 25),
    baselineTg: LIPID.baselineMgDl + LIPID.baselineBmiGain * Math.max(0, bmi - 24),
    muscleGlycogenMaxG: leanKg * MUSCLE.glycogenPerKgLean,
  };
}

// The water alcohol spreads through, in litres.
export const alcoholVolumeL = (body: Body) =>
  (body.sex === "male" ? ALCOHOL.widmarkMale : ALCOHOL.widmarkFemale) * body.weightKg;

// One MET is about 1 kcal per kg per hour, on top of resting burn for anything above rest.
export const postureKcalPerHour = (bmrKcalPerDay: number, weightKg: number, met: number) =>
  bmrKcalPerDay / 24 + (met - 1) * weightKg;
