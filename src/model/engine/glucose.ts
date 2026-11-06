import {
  COUPLING,
  ENERGY,
  FASTING,
  GLUCOSE,
  INSULIN,
  KCAL_PER_G,
  LIPID,
  LIVER,
  MUSCLE,
  PROTEIN,
  STOMACH,
  TRAINING,
} from "../params";
import { postureKcalPerHour } from "./anthropometrics";
import { Absorbed } from "./gut";
import { heldInGutKcal } from "./tracks";
import type { BodyConstants, Minute, Pools } from "./pools";

const { carb: CARB, protein: PROTEIN_KCAL, fat: FAT } = KCAL_PER_G;

export interface SugarFlows {
  secretion: number;
  insulinFraction: number; // how far insulin has risen above rest, from 0 to 1
  hepaticOutputG: number;
  insulinUptakeG: number; // what insulin moved out of the blood, wherever it went
  exerciseUptakeG: number; // what working muscle took with little insulin
  toMuscleG: number;
  toLiverG: number;
  toFatG: number;
}

// Bergman's minimal model, with an incretin term because oral glucose releases more insulin than the same
// glucose by vein.
export function stepGlucoseInsulin(
  pools: Pools,
  absorbed: Absorbed,
  { t, posture, muscleWork, i }: Minute,
  constants: BodyConstants,
): SugarFlows {
  const { anthro, channels, insulinCompensation, hepaticBaseGPerMin, glucoseSpaceDl } = constants;
  const { sensitivity } = anthro;
  const moving = Math.max(
    posture === "running"
      ? INSULIN.afterglowFromMoving.running
      : posture === "walking"
        ? INSULIN.afterglowFromMoving.walking
        : 0,
    muscleWork * COUPLING.afterglowPerMuscleWork,
  );
  pools.afterglow +=
    (moving - pools.afterglow) / (moving > pools.afterglow ? INSULIN.afterglowRiseMin : INSULIN.afterglowDecayMin);
  const eventSensitivity = Math.max(COUPLING.lowestInsulinSensitivity, 1 + channels.insulinSensitivity[i]);
  const activityBoost =
    INSULIN.activityBoost[posture] * (1 + INSULIN.afterglowGain * pools.afterglow) * eventSensitivity;
  if (heldInGutKcal(pools.tracks) > STOMACH.fedAboveKcal) pools.lastFed = t;
  const fastDrift =
    t < 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((t - pools.lastFed) / 60 - FASTING.driftStartsAfterH) /
              (FASTING.driftFullAfterH - FASTING.driftStartsAfterH),
          ),
        );
  const restingGlucose = anthro.baselineGlucose - FASTING.glucoseDropMgDl * fastDrift;
  const effortBrake = Math.min(
    INSULIN.exerciseBrakeMost,
    INSULIN.exerciseBrake[posture] + INSULIN.exerciseBrakePerMuscleWork * muscleWork,
  );
  const restingInsulin =
    INSULIN.baselineUUPerMl *
    (1 - FASTING.insulinDropShare * fastDrift) *
    (1 - INSULIN.exerciseBasalFall * effortBrake);
  const dG = pools.glucose - pools.previousGlucose;
  const secretion =
    (1 - effortBrake) *
    insulinCompensation *
    (INSULIN.glucoseGain * Math.max(0, pools.glucose - restingGlucose) +
      INSULIN.firstPhaseGain * Math.max(0, dG) +
      INSULIN.incretinGain * absorbed.glucoseSystemicMg +
      INSULIN.proteinGain * absorbed.proteinG * 10);
  pools.previousGlucose = pools.glucose;
  pools.insulin += secretion - INSULIN.clearancePerMin * (pools.insulin - restingInsulin);
  pools.insulinAction +=
    -INSULIN.actionDecayPerMin * pools.insulinAction +
    INSULIN.actionDecayPerMin * sensitivity * activityBoost * Math.max(0, pools.insulin - restingInsulin);

  const exerciseG = MUSCLE.uptakeGPerMinByActivity[posture] + TRAINING.uptakeGPerMinFullBody * muscleWork;
  const insulinFraction = Math.min(1, Math.max(0, pools.insulin - restingInsulin) / GLUCOSE.insulinEffectUpper);
  const liverAvailable = pools.liverGlycogen > LIVER.lowGlycogenG ? 1 : LIVER.lowGlycogenOutputShare;
  // The liver replaces what working muscle takes, unless insulin is holding it back.
  const exerciseMatchG =
    exerciseG *
    GLUCOSE.exerciseHepaticMatch *
    (1 - GLUCOSE.exerciseLiverInsulinBrake * insulinFraction) *
    liverAvailable;
  const basalHepaticG = hepaticBaseGPerMin * (1 - GLUCOSE.hepaticSuppression * insulinFraction) * liverAvailable;
  const extraHepaticG = basalHepaticG * channels.liverOutput[i];
  const hepaticOutputG = basalHepaticG + extraHepaticG + exerciseMatchG;
  const insulinUptakeMgDl = pools.insulinAction * pools.glucose;
  const massUptakeMgDl = GLUCOSE.effectiveness * (pools.glucose - restingGlucose);
  const uptakeG = Math.max(0, ((insulinUptakeMgDl + massUptakeMgDl) * glucoseSpaceDl) / 1000) + exerciseG;
  const inputMgDl = absorbed.glucoseSystemicMg / glucoseSpaceDl;
  const exerciseMgDl = ((exerciseG - exerciseMatchG) * 1000) / glucoseSpaceDl;
  const extraHepaticMgDl = (extraHepaticG * 1000) / glucoseSpaceDl;
  pools.glucose += inputMgDl + extraHepaticMgDl - insulinUptakeMgDl - massUptakeMgDl - exerciseMgDl;
  pools.glucose = Math.max(GLUCOSE.floorMgDl, pools.glucose);

  // Glucose bookkeeping across stores, split by who is taking it up.
  const insulinUptakeG = Math.max(0, uptakeG - exerciseG);
  const toMuscleG = insulinUptakeG * GLUCOSE.muscleShare + exerciseG;
  const toLiverG = insulinUptakeG * GLUCOSE.liverShare;
  const toFatG = insulinUptakeG * GLUCOSE.fatShare;
  pools.muscleGlycogen = Math.max(
    0,
    Math.min(
      anthro.muscleGlycogenMaxG,
      pools.muscleGlycogen +
        insulinUptakeG * GLUCOSE.muscleShare -
        MUSCLE.glycogenBurnGPerMinByActivity[posture] -
        TRAINING.glycogenGPerMinFullBody * muscleWork,
    ),
  );
  pools.liverGlycogen = Math.min(
    LIVER.glycogenMaxG,
    Math.max(
      0,
      pools.liverGlycogen +
        (toLiverG + absorbed.liverDirectG * LIVER.directUptakeStoredShare) * LIVER.glucoseToGlycogen -
        (hepaticOutputG - exerciseMatchG) *
          LIVER.glycogenShareOfOutput *
          (pools.liverGlycogen / (pools.liverGlycogen + LIVER.glycogenSparingG)) -
        exerciseMatchG *
          LIVER.exerciseFromGlycogen *
          (pools.liverGlycogen / (pools.liverGlycogen + LIVER.exerciseSparingG)),
    ),
  );

  const totalBloodG = pools.tracks.reduce((s, k) => s + k.bloodGlucoseG, 0);
  const clearedFraction = Math.min(1, totalBloodG > 0 ? uptakeG / totalBloodG : 0);
  for (const k of pools.tracks) {
    const out = k.bloodGlucoseG * clearedFraction;
    k.bloodGlucoseG -= out;
    const denom = Math.max(1e-6, toMuscleG + toLiverG + toFatG);
    k.dest.muscle += (out * toMuscleG * CARB) / denom;
    k.dest.liver += (out * toLiverG * CARB) / denom;
    k.dest.fat += (out * toFatG * CARB) / denom;
  }
  return {
    secretion,
    insulinFraction,
    hepaticOutputG,
    insulinUptakeG,
    exerciseUptakeG: exerciseG,
    toMuscleG,
    toLiverG,
    toFatG,
  };
}

// Triglycerides arrive through the lymph, not the portal vein, so they miss the liver at first.
export function stepFatAndProtein(
  pools: Pools,
  absorbed: Absorbed,
  { insulinFraction, toFatG }: SugarFlows,
  { anthro, tgSpaceDl }: BodyConstants,
) {
  const clearance = LIPID.clearancePerMin + LIPID.insulinClearanceBoost * insulinFraction;
  pools.tg += (absorbed.fatG * 1000) / tgSpaceDl - clearance * (pools.tg - anthro.baselineTg);
  const tgRemoved = (clearance * (pools.tg - anthro.baselineTg) * tgSpaceDl) / 1000;
  let bloodFat = 0;
  for (const k of pools.tracks) bloodFat += k.bloodFatG;
  const fatFractionOut = bloodFat > 0 ? Math.min(1, Math.max(0, tgRemoved) / bloodFat) : 0;
  for (const k of pools.tracks) {
    const out = k.bloodFatG * fatFractionOut;
    k.bloodFatG -= out;
    k.fatCleared += out;
    k.dest.fat += out * FAT * LIPID.adiposeShare;
    k.dest.burned += out * FAT * (1 - LIPID.adiposeShare);
    pools.fatStored += out * LIPID.adiposeShare;

    const amino = k.bloodAminoG * PROTEIN.bloodTurnoverPerMin;
    k.bloodAminoG -= amino;
    k.dest.liver += amino * PROTEIN_KCAL * PROTEIN.liverShare;
    k.dest.muscle += amino * PROTEIN_KCAL * PROTEIN.muscleShare;
    k.dest.burned += amino * PROTEIN_KCAL * PROTEIN.burnedShare;
  }
  pools.fatStored += toFatG * GLUCOSE.fatStoredShare;
}

export interface Energy {
  kcalPerHour: number;
  carbFuel: number;
}

export function stepEnergy(
  { tracks }: Pools,
  absorbed: Absorbed,
  { insulinFraction }: SugarFlows,
  { posture, muscleWork, i }: Minute,
  { anthro, body, channels }: BodyConstants,
): Energy {
  const met = ENERGY.mets[posture];
  const postureKcal = postureKcalPerHour(anthro.bmrKcalPerDay, body.weightKg, met);
  const thermicKcalPerHour =
    (absorbed.carbsG * CARB + absorbed.fatG * FAT + absorbed.proteinG * PROTEIN_KCAL) * 60 * ENERGY.thermicShare;
  const kcalPerHour = postureKcal * (1 + channels.metabolism[i]) + thermicKcalPerHour;
  const trainingFuel = COUPLING.trainingCarbFuelGain * Math.min(1, muscleWork / COUPLING.trainingFuelFullFromWork);
  const carbFuel = Math.min(
    ENERGY.carbFuelMost,
    ENERGY.carbFuelBase +
      ENERGY.carbFuelInsulinGain * insulinFraction +
      (posture === "running" ? ENERGY.carbFuelRunningGain : 0) +
      trainingFuel,
  );
  const burnBudget = (kcalPerHour / 60) * carbFuel * ENERGY.storedShareOfCarbBurn;
  for (const k of tracks) {
    const stored = k.dest.liver + k.dest.muscle;
    if (stored > 0) {
      const share =
        stored /
        Math.max(
          1,
          tracks.reduce((s, x) => s + x.dest.liver + x.dest.muscle, 0),
        );
      const burn = Math.min(stored, burnBudget * share);
      const liverPart = (k.dest.liver / stored) * burn;
      k.dest.liver -= liverPart;
      k.dest.muscle -= burn - liverPart;
      k.dest.burned += burn;
    }
  }
  return { kcalPerHour, carbFuel };
}
