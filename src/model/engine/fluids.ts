import { ALCOHOL, HEART, KIDNEY, STOMACH } from "../params";
import { Absorbed, Emptying, gutKcalOf } from "./gut";
import type { BodyConstants, Minute, Pools } from "./pools";

export function stepAlcoholAndFluids(pools: Pools, absorbed: Absorbed, { posture, asleep, i }: Minute, { channels, alcoholVolumeL, alcoholEliminationGPerMin }: BodyConstants) {
  pools.alcoholBodyG += absorbed.alcoholG;
  const alcoholGPerL = pools.alcoholBodyG / alcoholVolumeL;
  const foodSpeedsAlcohol = 1 + ALCOHOL.foodEliminationGain * Math.min(1, pools.digest / ALCOHOL.foodEffectFullFromDigestion);
  pools.alcoholBodyG = Math.max(0, pools.alcoholBodyG - (alcoholEliminationGPerMin * foodSpeedsAlcohol * alcoholGPerL) / (ALCOHOL.eliminationKmGPerL + alcoholGPerL));
  const obligateUrineMl = KIDNEY.urineMlPerMin * (asleep ? KIDNEY.sleepingUrineFactor : 1);
  pools.bodyWater = Math.max(0, pools.bodyWater + absorbed.waterMl - KIDNEY.insensibleMlPerMin - channels.fluidLoss[i]);
  const waterOut = pools.bodyWater * KIDNEY.waterExcretionRatePerMin;
  pools.bodyWater -= waterOut;
  pools.bladder += obligateUrineMl + waterOut;
  pools.fluidDeficitMl = Math.max(0, pools.fluidDeficitMl + channels.fluidLoss[i] + KIDNEY.insensibleMlPerMin + obligateUrineMl - absorbed.waterMl);
  if (pools.bladder > KIDNEY.voidAtMl && posture !== "sleeping") pools.bladder = KIDNEY.afterVoidMl;
}

export interface Contents {
  stomachKcal: number;
  stomachMl: number;
  gutKcal: number;
}

// What the stomach and gut hold now, which sets how hard digestion is working.
export function stepContents(pools: Pools, { solidKcal, energyRate }: Emptying, { t }: Minute): Contents {
  const stomachKcal = solidKcal - energyRate;
  let stomachLiquidNow = 0;
  let gutKcal = 0;
  let digestedMass = 0;
  for (const k of pools.tracks) {
    stomachLiquidNow += k.stomachLiquid;
    gutKcal += gutKcalOf(k);
    const nutrientMass = k.stomachCarb + k.stomachFat + k.stomachProtein + k.stomachFiber;
    const totalNutrients = k.intake.carbsG + k.intake.fatG + k.intake.proteinG + k.intake.fiberG;
    const solidMass = k.intake.grams - k.intake.waterMl;
    if (totalNutrients > 0 && t >= k.intake.at) digestedMass += (nutrientMass / totalNutrients) * Math.max(0, solidMass);
  }
  const stomachMl = STOMACH.restingVolumeMl + stomachLiquidNow + digestedMass + stomachKcal * STOMACH.secretionMlPerKcal;
  pools.digest += (Math.min(1, (stomachKcal + gutKcal * HEART.digestionGutWeight) / HEART.digestionFullKcal) - pools.digest) / HEART.digestionEaseMin;
  if (stomachKcal > STOMACH.fedAboveKcal || gutKcal > STOMACH.fedAboveKcal) pools.lastMealEnd = t;
  return { stomachKcal, stomachMl, gutKcal };
}
