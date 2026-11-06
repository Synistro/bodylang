import { COUPLING, FEEL, STOMACH } from "../params";
import type { Contents } from "./fluids";
import type { CaffeineLevels } from "./gut";
import { Pools, BodyConstants, Minute } from "./pools";

// The drowsiness one meal causes at some minutes after eating it.
export function mealDipOf(kcal: number, sinceMin: number): number {
  if (sinceMin < 0 || kcal < FEEL.postMealDipFromKcal) return 0;
  const phase = sinceMin / FEEL.postMealDipPeakMin;
  return FEEL.postMealDipStrength * Math.min(1, kcal / FEEL.postMealDipFullKcal) * phase * Math.exp(1 - phase);
}

// What makes you sleepy. The loop adds these up, and the feeling that explains it lists them.
export const drowsyFromMeal = (mealDip: number, caffeineFelt: number) => mealDip * (1 - caffeineFelt * FEEL.caffeineBluntsMealDip);
export const drowsyFromSleepPressure = (sleepPressure: number) => sleepPressure * FEEL.sleepPressureDrowsyShare;

export interface Feelings {
  mealDip: number;
  drowsy: number;
  alertness: number;
  fullness: number;
  hunger: number;
  jitter: number;
  crash: number;
}

export function stepFeeling(pools: Pools, { t, asleep, stress, i }: Minute, caffeine: CaffeineLevels, { stomachMl }: Contents, { channels }: BodyConstants): Feelings {
  const hours = t / 60;
  const circadianDip = FEEL.circadianDipDepth * Math.exp(-((((hours + 48) % 24) - FEEL.circadianDipHour) ** 2) / (2 * FEEL.circadianDipWidthH ** 2));
  pools.sleepPressure = asleep ? pools.sleepPressure * Math.exp(-1 / (FEEL.sleepPressureDecayTauH * 60)) : pools.sleepPressure + FEEL.sleepPressurePerHour / 60;
  let mealDip = 0;
  for (const k of pools.tracks) mealDip += mealDipOf(k.kcal, t - k.intake.at);
  const drowsiness = channels.drowsiness[i];
  const drowsy = Math.min(1, Math.max(0, drowsyFromMeal(mealDip, caffeine.felt) + circadianDip * FEEL.circadianDrowsyShare + drowsyFromSleepPressure(pools.sleepPressure) + drowsiness - COUPLING.drowsyPerStress * stress));
  const alertness = Math.min(1, Math.max(FEEL.alertnessFloorAwake, FEEL.alertnessRested + caffeine.felt * FEEL.caffeineAlertnessGain - circadianDip - pools.sleepPressure - mealDip * FEEL.mealDipAlertnessShare - COUPLING.alertnessPerDrowsiness * drowsiness + COUPLING.alertnessPerStress * stress + COUPLING.alertnessPerReward * channels.reward[i]));
  const fullness = Math.min(1, Math.max(0, (stomachMl - STOMACH.restingVolumeMl) / (STOMACH.fullnessMl - STOMACH.restingVolumeMl)));
  const sinceEmpty = t - pools.lastMealEnd;
  const sinceWoke = t - pools.wokeAt;
  const emptyDrive = Number.isFinite(sinceEmpty) ? sinceEmpty / FEEL.hungerAfterEmptyMin : FEEL.hungerOnWaking + ((1 - FEEL.hungerOnWaking) * sinceWoke) / FEEL.hungerFastingFullMin;
  const hunger = asleep ? 0 : Math.min(1, Math.max(0, Math.min(FEEL.hungerPlateau, emptyDrive) * (1 - fullness) * (1 + channels.appetite[i])));
  const jitter = Math.min(1, Math.max(0, (caffeine.felt - FEEL.jitterFromCaffeineFelt) / (1 - FEEL.jitterFromCaffeineFelt)));
  const crash = Math.min(1, Math.max(0, (FEEL.lowSugarFeltFromMgDl - pools.glucose) / (FEEL.lowSugarFeltFromMgDl - FEEL.lowSugarFullAtMgDl)));
  return { mealDip, drowsy, alertness, fullness, hunger, jitter, crash };
}
