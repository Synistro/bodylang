import { CAFFEINE, GLUCOSE, GUT, KCAL_PER_G, STOMACH, SUBSTANCE_STEP, COUPLING } from "../params";
import { availableCarbsG } from "../scenario";
import type { BodyConstants, Minute, Pools } from "./pools";

const { carb: CARB, protein: PROTEIN_KCAL, fat: FAT } = KCAL_PER_G;

export function ingest({ tracks, substanceTracks }: Pools, t: number) {
  for (const k of tracks) {
    if (k.intake.at === t) {
      k.stomachCarb += availableCarbsG(k.intake);
      k.stomachFat += k.intake.fatG;
      k.stomachProtein += k.intake.proteinG;
      k.stomachFiber += k.intake.fiberG;
      k.stomachLiquid += k.intake.waterMl;
      k.stomachCaffeine += k.intake.caffeineMg;
      k.stomachAlcohol += k.intake.alcoholG;
    }
  }
  for (const s of substanceTracks) {
    if (s.substance.at === t) s.gut += s.substance.doseMg * s.substance.bioavailability;
  }
}

export interface Emptying {
  solidKcal: number;
  energyRate: number;
  emptiedShare: number;
  liquidRate: number;
}

// Solids leave at a limited energy rate, shared across everything still in there.
export function emptyStomach({ tracks }: Pools, { t, posture, stress }: Minute): Emptying {
  let solidKcal = 0;
  let fatKcal = 0;
  let latestSolidAt = -Infinity;
  let liquidKcal = 0;
  for (const k of tracks) {
    const e = k.stomachCarb * CARB + k.stomachProtein * PROTEIN_KCAL + k.stomachFat * FAT;
    solidKcal += e;
    fatKcal += k.stomachFat * FAT;
    if (k.intake.liquid) liquidKcal += e;
    else if (e > STOMACH.solidCountsFromKcal && k.intake.at <= t) latestSolidAt = Math.max(latestSolidAt, k.intake.at);
  }
  const fatFraction = solidKcal > 0 ? fatKcal / solidKcal : 0;
  let energyRate = 0;
  if (solidKcal > 0.01 && t - latestSolidAt >= STOMACH.solidLagMin) {
    energyRate = (STOMACH.energyRateKcalPerMin + STOMACH.energyRateSizeGain * solidKcal) * (1 - STOMACH.fatSlowdown * fatFraction);
    energyRate *= 1 + (STOMACH.sugaryDrinkRateGain - 1) * (liquidKcal / solidKcal);
    energyRate /= 1 + STOMACH.fibreSlowdownPerGPer1000Kcal * (tracks.reduce((sum, k) => sum + k.stomachFiber, 0) / solidKcal) * 1000;
    if (posture === "walking") energyRate *= 1 + STOMACH.walkSpeedup;
    if (posture === "running") energyRate *= 1 - STOMACH.hardRunSlowdown;
    energyRate *= 1 - COUPLING.stressSlowsEmptying * stress;
    energyRate = Math.min(energyRate, solidKcal);
  }
  const liquidHalfLife = solidKcal - liquidKcal > STOMACH.solidsSlowLiquidsFromKcal ? STOMACH.liquidHalfLifeWithSolidsMin : STOMACH.liquidHalfLifeMin;
  return { solidKcal, energyRate, emptiedShare: solidKcal > 0 ? energyRate / solidKcal : 0, liquidRate: Math.LN2 / liquidHalfLife };
}

export interface Absorbed {
  glucoseSystemicMg: number; // past the liver, which is what moves blood sugar
  carbsG: number;
  fatG: number;
  proteinG: number;
  waterMl: number;
  alcoholG: number;
  liverDirectG: number; // fructose and the first-pass share of glucose
}

// From stomach to intestine, and from intestine to blood.
export function absorbGut({ tracks }: Pools, { emptiedShare, liquidRate }: Emptying, { caffeineClearancePerMin }: BodyConstants): Absorbed {
  const absorbed: Absorbed = { glucoseSystemicMg: 0, carbsG: 0, fatG: 0, proteinG: 0, waterMl: 0, alcoholG: 0, liverDirectG: 0 };
  for (const k of tracks) {
    const carbOut = k.stomachCarb * emptiedShare;
    const fatOut = k.stomachFat * emptiedShare;
    const proteinOut = k.stomachProtein * emptiedShare;
    const fiberOut = k.stomachFiber * emptiedShare;
    const liquidOut = k.stomachLiquid * liquidRate;
    const caffeineOut = k.stomachCaffeine * liquidRate;
    const alcoholOut = k.stomachAlcohol * liquidRate;
    k.stomachCarb -= carbOut;
    k.stomachFat -= fatOut;
    k.stomachProtein -= proteinOut;
    k.stomachFiber -= fiberOut;
    k.stomachLiquid -= liquidOut;
    k.stomachCaffeine -= caffeineOut;
    k.stomachAlcohol -= alcoholOut;
    k.gutCarb += carbOut;
    k.gutFat += fatOut;
    k.gutProtein += proteinOut;
    k.gutCaffeine += caffeineOut;
    k.gutAlcohol += alcoholOut;
    k.dest.colon += fiberOut * GUT.fiberKcalPerG;
    absorbed.waterMl += liquidOut * GUT.waterAbsorbedShare;

    // What the gut can't take up carries on to the colon as energy.
    const carbAbs = k.gutCarb * GUT.carbRatePerMin;
    const fatAbs = k.gutFat * GUT.fatRatePerMin;
    const proteinAbs = k.gutProtein * GUT.proteinRatePerMin;
    k.gutCarb -= carbAbs;
    k.gutFat -= fatAbs;
    k.gutProtein -= proteinAbs;
    k.dest.colon += carbAbs * (1 - GUT.carbBioavailability) * CARB + fatAbs * (1 - GUT.fatBioavailability) * FAT + proteinAbs * (1 - GUT.proteinBioavailability) * PROTEIN_KCAL;

    const carbIn = carbAbs * GUT.carbBioavailability;
    const fatIn = fatAbs * GUT.fatBioavailability;
    const proteinIn = proteinAbs * GUT.proteinBioavailability;
    absorbed.carbsG += carbIn;
    absorbed.fatG += fatIn;
    absorbed.proteinG += proteinIn;
    k.carbsAbsorbedPerMin = carbIn;
    k.fatAbsorbedPerMin = fatIn;

    // Fructose and the first-pass share of glucose stop at the liver.
    const available = availableCarbsG(k.intake);
    const sugarShare = available > 0 ? Math.min(1, k.intake.sugarG / available) : 0;
    const fructoseIn = carbIn * sugarShare * (k.intake.fructoseShare ?? GLUCOSE.fructoseShare) * GLUCOSE.fructoseToLiver;
    const glucoseIn = carbIn - fructoseIn;
    const systemic = glucoseIn * GLUCOSE.systemicShare;
    const toLiver = carbIn - systemic;
    absorbed.liverDirectG += toLiver;
    k.dest.liver += toLiver * CARB;
    k.bloodGlucoseG += systemic;
    absorbed.glucoseSystemicMg += systemic * 1000;
    k.bloodFatG += fatIn;
    k.bloodAminoG += proteinIn;

    const cafAbs = k.gutCaffeine * GUT.caffeineRatePerMin;
    k.gutCaffeine -= cafAbs;
    k.caffeineBody += cafAbs;
    const cafClear = k.caffeineBody * caffeineClearancePerMin;
    k.caffeineBody -= cafClear;
    k.caffeineCleared += cafClear;

    const alcAbs = k.gutAlcohol * GUT.alcoholRatePerMin;
    k.gutAlcohol -= alcAbs;
    absorbed.alcoholG += alcAbs;
    k.alcoholAbsorbed += alcAbs;
  }
  return absorbed;
}

function absorptionRateForTmax(tmaxMin: number, ke: number): number {
  // tmax = ln(ka/ke)/(ka-ke); bisection keeps this free of any solver dependency.
  let lo = ke * 1.0001;
  let hi: number = SUBSTANCE_STEP.maxAbsorptionPerMin;
  for (let i = 0; i < 40; i++) {
    const ka = (lo + hi) / 2;
    if (Math.log(ka / ke) / (ka - ke) > tmaxMin) lo = ka;
    else hi = ka;
  }
  return (lo + hi) / 2;
}

// A one-compartment oral model whose absorption rate reproduces the requested tmax.
export function stepSubstances({ substanceTracks }: Pools, { body }: BodyConstants, i: number) {
  for (const s of substanceTracks) {
    const ke = Math.min(SUBSTANCE_STEP.maxClearancePerMin, Math.LN2 / (s.substance.halfLifeH * 60));
    const ka = absorptionRateForTmax(s.substance.tmaxMin, ke);
    const absorbed = s.gut * ka;
    s.gut -= absorbed;
    s.body += absorbed;
    const cleared = s.body * ke;
    s.body -= cleared;
    s.cleared += cleared;
    s.series[i] = s.body / (s.substance.volumeLPerKg * body.weightKg);
    s.ledger[i * 3] = s.gut;
    s.ledger[i * 3 + 1] = s.body;
    s.ledger[i * 3 + 2] = s.cleared;
  }
}

export interface CaffeineLevels {
  mgL: number;
  occupancy: number; // the share of receptors blocked
  felt: number; // how much a dose is felt
}

export function caffeineLevels({ tracks }: Pools, { caffeineVolumeL }: BodyConstants): CaffeineLevels {
  const mg = tracks.reduce((sum, k) => sum + k.caffeineBody, 0);
  const mgL = mg / caffeineVolumeL;
  const um = mgL * CAFFEINE.molarMgPerLToUm;
  return { mgL, occupancy: um / (um + CAFFEINE.receptorA1Ic50Um), felt: mgL / (mgL + CAFFEINE.feltHalfEffectMgL) };
}
