import { Cycle, cycleDay, hormonesAt, lutealShare } from "./cycle";
import { activityBouts, ChannelId, channelSeries, maxHeartRate, muscleWorkSeries, resolveEvent, runSessions } from "./events";
import { ALCOHOL, BLOOD_FLOW, BODY_TEMPERATURE, CAFFEINE, COUPLING, CYCLE, DAY, ENERGY, FASTING, FEEL, GLUCOSE, GUT, HEART, INSULIN, KIDNEY, LIPID, LIVER, MUSCLE, PROTEIN, RESTING_SYSTOLIC_MMHG, STOMACH, SUBSTANCE_STEP, TRAINING } from "./params";
import { CustomSubstance, Intake, kcalOf, availableCarbsG, Posture, postureAt, Scenario } from "./scenario";
import { alcoholVolumeL, anthropometrics, postureKcalPerHour } from "./engine/anthropometrics";
import { FLOW_SIZE, LEDGER_SIZE, SERIES, SeriesName, Trajectory } from "./engine/trajectory";

interface IntakeTrack {
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

interface SubstanceTrack {
  substance: CustomSubstance;
  gut: number;
  body: number;
  cleared: number;
  series: Float32Array; // mg/L per minute
  ledger: Float32Array; // gut, body, cleared per minute
}

// A cycle only applies to a body with the anatomy for one.
export const cycleOf = (s: Pick<Scenario, "body" | "cycle">): Cycle | null => (s.body.sex === "female" ? s.cycle ?? null : null);

// The small, steady changes of the luteal phase, added on top of whatever else is pushing these channels.
function addCycleChannels(channels: Record<ChannelId, Float32Array>, cycle: Cycle, start: number) {
  const add: [ChannelId, number][] = [
    ["temperature", CYCLE.luteal.temperatureC],
    ["heartRate", CYCLE.luteal.heartBpm],
    ["insulinSensitivity", CYCLE.luteal.insulinSensitivity],
    ["metabolism", CYCLE.luteal.metabolism],
    ["appetite", CYCLE.luteal.appetite],
  ];
  for (const [channel, amount] of add) {
    const out = Float32Array.from(channels[channel]);
    for (let i = 0; i < out.length; i++) out[i] += amount * lutealShare(cycle, i + start);
    channels[channel] = out;
  }
}

const POSTURE_INDEX: Record<Posture, number> = { sleeping: 0, sitting: 1, standing: 2, walking: 3, running: 4 };
// The drowsiness one meal causes at some minutes after eating it.
export function mealDipOf(kcal: number, sinceMin: number): number {
  if (sinceMin < 0 || kcal < FEEL.postMealDipFromKcal) return 0;
  const phase = sinceMin / FEEL.postMealDipPeakMin;
  return FEEL.postMealDipStrength * Math.min(1, kcal / FEEL.postMealDipFullKcal) * phase * Math.exp(1 - phase);
}

// How long before 00:00 today the run has to start, in whole days so the clock it starts on stays 00:00.
function leadInMinutes({ intakes, substances, activities }: Scenario): number {
  const earliest = Math.min(0, ...intakes.map((i) => i.at), ...substances.map((s) => s.at), ...activities.map((a) => a.from));
  return Math.min(DAY.carryDaysMost, Math.ceil(-earliest / 1440)) * 1440;
}

export function simulate(scenario: Scenario): Trajectory {
  const anthro = anthropometrics(scenario.body);
  const { body } = scenario;
  // Whatever is still in the body from yesterday gets there by running yesterday first.
  const leadIn = leadInMinutes(scenario);
  const n = leadIn + DAY.minutes + 1;
  const series = Object.fromEntries(SERIES.map((s) => [s, new Float32Array(n)])) as Record<SeriesName, Float32Array>;

  const keCaffeine = Math.LN2 / (anthro.caffeineHalfLifeH * 60);
  const { sensitivity } = anthro;
  const compensation = (INSULIN.sensitivity / sensitivity) ** INSULIN.resistanceCompensationPower;
  const activities = [...scenario.activities].sort((a, b) => a.from - b.from);
  // Sorted so the same events give the same bits, whatever order they were told in.
  const events = [...(scenario.events ?? [])].sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1)).map((event) => resolveEvent(event, { body, anthro }));
  const channels = channelSeries(events, n, activityBouts(activities, { body, anthro }), -leadIn);
  const muscleWork = muscleWorkSeries(events, n, -leadIn);
  const cycle = cycleOf(scenario);
  if (cycle) addCycleChannels(channels, cycle, -leadIn);
  const maxBpm = maxHeartRate(body.age);

  const tracks: IntakeTrack[] = scenario.intakes
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((intake) => ({
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
      ledger: new Float32Array(n * LEDGER_SIZE),
      caffeineLedger: new Float32Array(n * 4),
      caffeineBody: 0,
      caffeineCleared: 0,
      flows: new Float32Array(n * FLOW_SIZE),
      carbsAbsorbedPerMin: 0,
      fatAbsorbedPerMin: 0,
      fatCleared: 0,
      alcoholAbsorbed: 0,
    }));

  const substanceTracks: SubstanceTrack[] = scenario.substances.map((substance) => ({
    substance,
    gut: 0,
    body: 0,
    cleared: 0,
    series: new Float32Array(n),
    ledger: new Float32Array(n * 3),
  }));

  // Slow pools settle across a simulated night before the visible day starts.
  let G = anthro.baselineGlucose;
  let I = INSULIN.baselineUUPerMl;
  let X = 0;
  let TG = anthro.baselineTg;
  let alcoholBodyG = 0;
  let liverGlycogen: number = LIVER.glycogenStartG;
  let muscleGlycogen = anthro.muscleGlycogenMaxG * MUSCLE.glycogenStartShare;
  let fatStored = 0;
  let bladder: number = KIDNEY.bladderStartMl;
  let bodyWater = 0;
  let previousG = G;
  let lastMealEnd = -Infinity;
  let afterglow = 0;
  let digest = 0;
  let strokeGain = 0;
  let fluidDeficitMl = 0;
  let lastFed: number = FASTING.assumedLastMealMin - leadIn;
  // The day before counts: last night's bedtime and how long ago you woke carry into sleep pressure.
  const wakingHoursYesterday = (DAY.sleepMin - DAY.wakeMin) / 60;
  const startsAwake = postureAt(activities, -leadIn) !== "sleeping";
  let hoursAwake = startsAwake ? wakingHoursYesterday + (1440 - DAY.sleepMin) / 60 : 0;
  let sleepPressure = startsAwake ? hoursAwake * FEEL.sleepPressurePerHour : wakingHoursYesterday * FEEL.sleepPressurePerHour * Math.exp(-((1440 - DAY.sleepMin) / 60) / FEEL.sleepPressureDecayTauH);
  let wokeAt = startsAwake ? -leadIn : -Infinity;

  const fatKg = Math.max(0, body.weightKg - anthro.leanKg);
  const Vg = GLUCOSE.distributionDlPerKgLean * (anthro.leanKg + GLUCOSE.distributionFatShare * fatKg);
  const Vtg = LIPID.plasmaDlPerKg * body.weightKg;
  const hepaticBase = GLUCOSE.hepaticOutputGPerMinPerKg * body.weightKg;
  const caffeineVolume = CAFFEINE.volumeLPerKg * body.weightKg;
  const widmark = alcoholVolumeL(body);
  const alcoholElimGPerMin = (ALCOHOL.eliminationGPerLPerH * widmark) / 60;

  for (let i = 0; i < n; i++) {
    const t = i - leadIn;
    // A day nobody logged in full would otherwise read as a day of fasting. Only what the log can
    // really say carries over: what is still in the gut and blood, and how you slept.
    if (t === 0 && leadIn > 0) {
      liverGlycogen = LIVER.glycogenStartG;
      muscleGlycogen = anthro.muscleGlycogenMaxG * MUSCLE.glycogenStartShare;
      fatStored = 0;
      fluidDeficitMl = 0;
      bladder = KIDNEY.bladderStartMl;
      lastFed = Math.max(lastFed, FASTING.assumedLastMealMin);
      if (stomachKcalBefore(tracks) <= STOMACH.fedAboveKcal) lastMealEnd = -Infinity;
      if (postureAt(activities, 0) === "sleeping") wokeAt = -Infinity;
    }
    const posture = postureAt(activities, t);
    const asleep = posture === "sleeping";
    if (!asleep && !Number.isFinite(wokeAt)) wokeAt = t;
    hoursAwake = asleep ? 0 : hoursAwake + 1 / 60;
    const stress = Math.min(1, channels.stress[i]);

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

    // Stomach: solids leave at a limited energy rate, shared across everything still in there.
    let solidKcal = 0;
    let fatKcal = 0;
    let latestSolidAt = -Infinity;
    let liquidKcal = 0;
    for (const k of tracks) {
      const e = k.stomachCarb * 4 + k.stomachProtein * 4 + k.stomachFat * 9;
      solidKcal += e;
      fatKcal += k.stomachFat * 9;
      if (k.intake.liquid) liquidKcal += e;
      else if (e > 0.5 && k.intake.at <= t) latestSolidAt = Math.max(latestSolidAt, k.intake.at);
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
    const emptiedShare = solidKcal > 0 ? energyRate / solidKcal : 0;
    const liquidHalfLife = solidKcal - liquidKcal > 20 ? STOMACH.liquidHalfLifeWithSolidsMin : STOMACH.liquidHalfLifeMin;
    const liquidRate = Math.LN2 / liquidHalfLife;

    let absorbedGlucoseSystemicMg = 0;
    let absorbedCarbsG = 0;
    let absorbedFatG = 0;
    let absorbedProteinG = 0;
    let waterAbsorbed = 0;
    let alcoholAbsorbed = 0;
    let liverDirectG = 0;

    for (const k of tracks) {
      // Stomach to intestine
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
      waterAbsorbed += liquidOut * GUT.waterAbsorbedShare;

      // Intestine to blood. What the gut can't take up carries on to the colon as energy.
      const carbAbs = k.gutCarb * GUT.carbRatePerMin;
      const fatAbs = k.gutFat * GUT.fatRatePerMin;
      const proteinAbs = k.gutProtein * GUT.proteinRatePerMin;
      k.gutCarb -= carbAbs;
      k.gutFat -= fatAbs;
      k.gutProtein -= proteinAbs;
      k.dest.colon += carbAbs * (1 - GUT.carbBioavailability) * 4 + fatAbs * (1 - GUT.fatBioavailability) * 9 + proteinAbs * (1 - GUT.proteinBioavailability) * 4;

      const carbIn = carbAbs * GUT.carbBioavailability;
      const fatIn = fatAbs * GUT.fatBioavailability;
      const proteinIn = proteinAbs * GUT.proteinBioavailability;
      absorbedCarbsG += carbIn;
      absorbedFatG += fatIn;
      absorbedProteinG += proteinIn;
      k.carbsAbsorbedPerMin = carbIn;
      k.fatAbsorbedPerMin = fatIn;

      // Fructose and the first-pass share of glucose stop at the liver.
      const available = availableCarbsG(k.intake);
      const sugarShare = available > 0 ? Math.min(1, k.intake.sugarG / available) : 0;
      const fructoseIn = carbIn * sugarShare * (k.intake.fructoseShare ?? GLUCOSE.fructoseShare) * GLUCOSE.fructoseToLiver;
      const glucoseIn = carbIn - fructoseIn;
      const systemic = glucoseIn * GLUCOSE.systemicShare;
      const toLiver = carbIn - systemic;
      liverDirectG += toLiver;
      k.dest.liver += toLiver * 4;
      k.bloodGlucoseG += systemic;
      absorbedGlucoseSystemicMg += systemic * 1000;
      k.bloodFatG += fatIn;
      k.bloodAminoG += proteinIn;

      const cafAbs = k.gutCaffeine * GUT.caffeineRatePerMin;
      k.gutCaffeine -= cafAbs;
      k.caffeineBody += cafAbs;
      const cafClear = k.caffeineBody * keCaffeine;
      k.caffeineBody -= cafClear;
      k.caffeineCleared += cafClear;

      const alcAbs = k.gutAlcohol * GUT.alcoholRatePerMin;
      k.gutAlcohol -= alcAbs;
      alcoholAbsorbed += alcAbs;
      k.alcoholAbsorbed += alcAbs;
    }

    for (const s of substanceTracks) {
      // A one-compartment oral model whose absorption rate reproduces the requested tmax.
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

    alcoholBodyG += alcoholAbsorbed;
    const alcoholGPerL = alcoholBodyG / widmark;
    const foodSpeedsAlcohol = 1 + ALCOHOL.foodEliminationGain * Math.min(1, digest / ALCOHOL.foodEffectFullFromDigestion);
    alcoholBodyG = Math.max(0, alcoholBodyG - (alcoholElimGPerMin * foodSpeedsAlcohol * alcoholGPerL) / (ALCOHOL.eliminationKmGPerL + alcoholGPerL));
    const obligateUrineMl = KIDNEY.urineMlPerMin * (asleep ? KIDNEY.sleepingUrineFactor : 1);
    bodyWater = Math.max(0, bodyWater + waterAbsorbed - KIDNEY.insensibleMlPerMin - channels.fluidLoss[i]);
    const waterOut = bodyWater * KIDNEY.waterExcretionRatePerMin;
    bodyWater -= waterOut;
    bladder += obligateUrineMl + waterOut;
    fluidDeficitMl = Math.max(0, fluidDeficitMl + channels.fluidLoss[i] + KIDNEY.insensibleMlPerMin + obligateUrineMl - waterAbsorbed);
    if (bladder > KIDNEY.voidAtMl && posture !== "sleeping") bladder = KIDNEY.afterVoidMl;

    // Insulin and glucose: Bergman's minimal model, with an incretin term because oral glucose
    // releases more insulin than the same glucose by vein.
    const moving = Math.max(posture === "running" ? INSULIN.afterglowFromMoving.running : posture === "walking" ? INSULIN.afterglowFromMoving.walking : 0, muscleWork[i] * COUPLING.afterglowPerMuscleWork);
    afterglow += (moving - afterglow) / (moving > afterglow ? INSULIN.afterglowRiseMin : INSULIN.afterglowDecayMin);
    const eventSensitivity = Math.max(COUPLING.lowestInsulinSensitivity, 1 + channels.insulinSensitivity[i]);
    const activityBoost = INSULIN.activityBoost[posture] * (1 + INSULIN.afterglowGain * afterglow) * eventSensitivity;
    if (stomachKcalBefore(tracks) > STOMACH.fedAboveKcal) lastFed = t;
    const fastDrift = t < 0 ? 0 : Math.max(0, Math.min(1, ((t - lastFed) / 60 - FASTING.driftStartsAfterH) / (FASTING.driftFullAfterH - FASTING.driftStartsAfterH)));
    const restingGlucose = anthro.baselineGlucose - FASTING.glucoseDropMgDl * fastDrift;
    const effortBrake = Math.min(INSULIN.exerciseBrakeMost, INSULIN.exerciseBrake[posture] + INSULIN.exerciseBrakePerMuscleWork * muscleWork[i]);
    const restingInsulin = INSULIN.baselineUUPerMl * (1 - FASTING.insulinDropShare * fastDrift) * (1 - INSULIN.exerciseBasalFall * effortBrake);
    const dG = G - previousG;
    const secretion =
      (1 - effortBrake) *
      compensation *
      (INSULIN.glucoseGain * Math.max(0, G - restingGlucose) +
        INSULIN.firstPhaseGain * Math.max(0, dG) +
        INSULIN.incretinGain * absorbedGlucoseSystemicMg +
        INSULIN.proteinGain * absorbedProteinG * 10);
    previousG = G;
    I += secretion - INSULIN.clearancePerMin * (I - restingInsulin);
    X += -INSULIN.actionDecayPerMin * X + INSULIN.actionDecayPerMin * sensitivity * activityBoost * Math.max(0, I - restingInsulin);

    const exerciseG = MUSCLE.uptakeGPerMinByActivity[posture] + TRAINING.uptakeGPerMinFullBody * muscleWork[i];
    const insulinFraction = Math.min(1, Math.max(0, I - restingInsulin) / GLUCOSE.insulinEffectUpper);
    const liverAvailable = liverGlycogen > LIVER.lowGlycogenG ? 1 : LIVER.lowGlycogenOutputShare;
    // The liver replaces what working muscle takes, unless insulin is holding it back.
    const exerciseMatchG = exerciseG * GLUCOSE.exerciseHepaticMatch * (1 - GLUCOSE.exerciseLiverInsulinBrake * insulinFraction) * liverAvailable;
    const basalHepaticG = hepaticBase * (1 - GLUCOSE.hepaticSuppression * insulinFraction) * liverAvailable;
    const extraHepaticG = basalHepaticG * channels.liverOutput[i];
    const hepaticOutput = basalHepaticG + extraHepaticG + exerciseMatchG;
    const insulinUptakeMgDl = X * G;
    const massUptakeMgDl = GLUCOSE.effectiveness * (G - restingGlucose);
    const uptakeG = Math.max(0, ((insulinUptakeMgDl + massUptakeMgDl) * Vg) / 1000) + exerciseG;
    const inputMgDl = absorbedGlucoseSystemicMg / Vg;
    const exerciseMgDl = ((exerciseG - exerciseMatchG) * 1000) / Vg;
    const extraHepaticMgDl = (extraHepaticG * 1000) / Vg;
    G += inputMgDl + extraHepaticMgDl - insulinUptakeMgDl - massUptakeMgDl - exerciseMgDl;
    G = Math.max(GLUCOSE.floorMgDl, G);

    // Glucose bookkeeping across stores, split by who is taking it up.
    const insulinUptakeG = Math.max(0, uptakeG - exerciseG);
    const toMuscleG = insulinUptakeG * GLUCOSE.muscleShare + exerciseG;
    const toLiverG = insulinUptakeG * GLUCOSE.liverShare;
    const toFatG = insulinUptakeG * GLUCOSE.fatShare;
    muscleGlycogen = Math.max(0, Math.min(anthro.muscleGlycogenMaxG, muscleGlycogen + insulinUptakeG * GLUCOSE.muscleShare - MUSCLE.glycogenBurnGPerMinByActivity[posture] - TRAINING.glycogenGPerMinFullBody * muscleWork[i]));
    liverGlycogen = Math.min(LIVER.glycogenMaxG, Math.max(0, liverGlycogen + (toLiverG + liverDirectG * LIVER.directUptakeStoredShare) * LIVER.glucoseToGlycogen - (hepaticOutput - exerciseMatchG) * LIVER.glycogenShareOfOutput * (liverGlycogen / (liverGlycogen + LIVER.glycogenSparingG)) - exerciseMatchG * LIVER.exerciseFromGlycogen * (liverGlycogen / (liverGlycogen + LIVER.exerciseSparingG))));

    const totalBloodG = tracks.reduce((s, k) => s + k.bloodGlucoseG, 0);
    const clearedFraction = Math.min(1, totalBloodG > 0 ? uptakeG / totalBloodG : 0);
    for (const k of tracks) {
      const out = k.bloodGlucoseG * clearedFraction;
      k.bloodGlucoseG -= out;
      const denom = Math.max(1e-6, toMuscleG + toLiverG + toFatG);
      k.dest.muscle += (out * toMuscleG * 4) / denom;
      k.dest.liver += (out * toLiverG * 4) / denom;
      k.dest.fat += (out * toFatG * 4) / denom;
    }

    // Triglycerides arrive through the lymph, not the portal vein, so they miss the liver at first.
    const clearance = LIPID.clearancePerMin + LIPID.insulinClearanceBoost * insulinFraction;
    TG += (absorbedFatG * 1000) / Vtg - clearance * (TG - anthro.baselineTg);
    const tgRemoved = ((clearance * (TG - anthro.baselineTg)) * Vtg) / 1000;
    let bloodFat = 0;
    for (const k of tracks) bloodFat += k.bloodFatG;
    const fatFractionOut = bloodFat > 0 ? Math.min(1, Math.max(0, tgRemoved) / bloodFat) : 0;
    for (const k of tracks) {
      const out = k.bloodFatG * fatFractionOut;
      k.bloodFatG -= out;
      k.fatCleared += out;
      k.dest.fat += out * 9 * LIPID.adiposeShare;
      k.dest.burned += out * 9 * (1 - LIPID.adiposeShare);
      fatStored += out * LIPID.adiposeShare;

      const amino = k.bloodAminoG * PROTEIN.bloodTurnoverPerMin;
      k.bloodAminoG -= amino;
      k.dest.liver += amino * 4 * PROTEIN.liverShare;
      k.dest.muscle += amino * 4 * PROTEIN.muscleShare;
      k.dest.burned += amino * 4 * PROTEIN.burnedShare;
    }
    fatStored += toFatG * GLUCOSE.fatStoredShare;

    const caffeineMg = tracks.reduce((s, k) => s + k.caffeineBody, 0);
    const caffeineMgL = caffeineMg / caffeineVolume;
    const caffeineUm = caffeineMgL * CAFFEINE.molarMgPerLToUm;
    const occupancy = caffeineUm / (caffeineUm + CAFFEINE.receptorA1Ic50Um);
    const caffeineFelt = caffeineMgL / (caffeineMgL + CAFFEINE.feltHalfEffectMgL);

    const stomachKcal = solidKcal - energyRate;
    let stomachLiquidNow = 0;
    let gutKcal = 0;
    let digestedMass = 0;
    for (const k of tracks) {
      stomachLiquidNow += k.stomachLiquid;
      gutKcal += k.gutCarb * 4 + k.gutFat * 9 + k.gutProtein * 4;
      const nutrientMass = k.stomachCarb + k.stomachFat + k.stomachProtein + k.stomachFiber;
      const totalNutrients = k.intake.carbsG + k.intake.fatG + k.intake.proteinG + k.intake.fiberG;
      const solidMass = k.intake.grams - k.intake.waterMl;
      if (totalNutrients > 0 && t >= k.intake.at) digestedMass += (nutrientMass / totalNutrients) * Math.max(0, solidMass);
    }
    const stomachMl = STOMACH.restingVolumeMl + stomachLiquidNow + digestedMass + stomachKcal * STOMACH.secretionMlPerKcal;

    digest += (Math.min(1, (stomachKcal + gutKcal * HEART.digestionGutWeight) / HEART.digestionFullKcal) - digest) / HEART.digestionEaseMin;
    if (stomachKcal > STOMACH.fedAboveKcal || gutKcal > STOMACH.fedAboveKcal) lastMealEnd = t;

    // Heart and blood distribution
    const hr = Math.min(maxBpm, anthro.restingBpm + HEART.byActivity[posture] + HEART.digestionGain * digest + HEART.caffeineGainPerMgL * caffeineMgL + channels.heartRate[i]);
    const exerting = posture === "walking" || posture === "running" || channels.muscleFlow[i] >= HEART.strokeWorkingFromMuscleFlow;
    const reserveUsed = exerting ? Math.max(0, channels.heartRate[i]) / (maxBpm - anthro.restingBpm) : 0;
    strokeGain += (Math.min(1, reserveUsed / HEART.strokePlateauReserveShare) - strokeGain) / HEART.strokeEaseMin;
    const strokeMl = HEART.strokeVolumeMlPerKgLean * anthro.leanKg * (1 + HEART.strokeExerciseGain * strokeGain);
    const cardiacOutput = (hr * strokeMl) / 1000;
    const flowMuscle = BLOOD_FLOW.rest.muscle + BLOOD_FLOW.activityMuscleGain[posture] + channels.muscleFlow[i];
    const movingCut = 1 - BLOOD_FLOW.activityGutKidneyCut[posture];
    const flowGut = (BLOOD_FLOW.rest.gut + BLOOD_FLOW.digestionGutGain * digest) * (1 - COUPLING.stressCutsGutFlow * stress) * movingCut;
    const flowKidneys = BLOOD_FLOW.rest.kidneys * movingCut;
    const flowTotal = BLOOD_FLOW.rest.brain + BLOOD_FLOW.rest.heart + flowKidneys + flowGut + flowMuscle + BLOOD_FLOW.rest.skin + BLOOD_FLOW.rest.other;

    // Energy
    const met = ENERGY.mets[posture];
    const postureKcal = postureKcalPerHour(anthro.bmrKcalPerDay, body.weightKg, met);
    const thermicKcalPerHour = (absorbedCarbsG * 4 + absorbedFatG * 9 + absorbedProteinG * 4) * 60 * ENERGY.thermicShare;
    const kcalPerHour = postureKcal * (1 + channels.metabolism[i]) + thermicKcalPerHour;
    const trainingFuel = COUPLING.trainingCarbFuelGain * Math.min(1, muscleWork[i] / COUPLING.trainingFuelFullFromWork);
    const carbFuel = Math.min(ENERGY.carbFuelMost, ENERGY.carbFuelBase + ENERGY.carbFuelInsulinGain * insulinFraction + (posture === "running" ? ENERGY.carbFuelRunningGain : 0) + trainingFuel);
    const burnPerMin = kcalPerHour / 60;
    const burnBudget = burnPerMin * carbFuel * ENERGY.storedShareOfCarbBurn;
    for (const k of tracks) {
      const stored = k.dest.liver + k.dest.muscle;
      if (stored > 0) {
        const share = stored / Math.max(1, tracks.reduce((s, x) => s + x.dest.liver + x.dest.muscle, 0));
        const burn = Math.min(stored, burnBudget * share);
        const liverPart = (k.dest.liver / stored) * burn;
        k.dest.liver -= liverPart;
        k.dest.muscle -= burn - liverPart;
        k.dest.burned += burn;
      }
    }

    // How it should feel
    const hours = t / 60;
    const circadianDip = FEEL.circadianDipDepth * Math.exp(-((((hours + 48) % 24) - FEEL.circadianDipHour) ** 2) / (2 * FEEL.circadianDipWidthH ** 2));
    sleepPressure = asleep ? sleepPressure * Math.exp(-1 / (FEEL.sleepPressureDecayTauH * 60)) : sleepPressure + FEEL.sleepPressurePerHour / 60;
    let mealDip = 0;
    for (const k of tracks) mealDip += mealDipOf(k.kcal, t - k.intake.at);
    const drowsiness = channels.drowsiness[i];
    const drowsy = Math.min(1, Math.max(0, mealDip * (1 - caffeineFelt * FEEL.caffeineBluntsMealDip) + circadianDip * FEEL.circadianDrowsyShare + sleepPressure * FEEL.sleepPressureDrowsyShare + drowsiness - COUPLING.drowsyPerStress * stress));
    const alertness = Math.min(1, Math.max(FEEL.alertnessFloorAwake, FEEL.alertnessRested + caffeineFelt * FEEL.caffeineAlertnessGain - circadianDip - sleepPressure - mealDip * FEEL.mealDipAlertnessShare - COUPLING.alertnessPerDrowsiness * drowsiness + COUPLING.alertnessPerStress * stress + COUPLING.alertnessPerReward * channels.reward[i]));
    const fullness = Math.min(1, Math.max(0, (stomachMl - STOMACH.restingVolumeMl) / (STOMACH.fullnessMl - STOMACH.restingVolumeMl)));
    const sinceEmpty = t - lastMealEnd;
    const sinceWoke = t - wokeAt;
    const emptyDrive = Number.isFinite(sinceEmpty) ? sinceEmpty / FEEL.hungerAfterEmptyMin : FEEL.hungerOnWaking + ((1 - FEEL.hungerOnWaking) * sinceWoke) / FEEL.hungerFastingFullMin;
    const hunger = asleep ? 0 : Math.min(1, Math.max(0, Math.min(FEEL.hungerPlateau, emptyDrive) * (1 - fullness) * (1 + channels.appetite[i])));
    const jitter = Math.min(1, Math.max(0, (caffeineFelt - FEEL.jitterFromCaffeineFelt) / (1 - FEEL.jitterFromCaffeineFelt)));
    const crash = Math.min(1, Math.max(0, (FEEL.lowSugarFeltFromMgDl - G) / (FEEL.lowSugarFeltFromMgDl - FEEL.lowSugarFullAtMgDl)));

    // Record
    series.glucose[i] = G;
    series.insulin[i] = I;
    series.insulinAction[i] = X;
    series.tg[i] = TG;
    series.caffeine[i] = caffeineMgL;
    series.occupancy[i] = occupancy;
    series.alcohol[i] = alcoholBodyG / widmark;
    series.hr[i] = hr;
    series.breaths[i] = HEART.breathsByActivity[posture] + digest * HEART.breathsPerDigestion + channels.breathing[i];
    series.cardiacOutput[i] = cardiacOutput;
    series.flowBrain[i] = BLOOD_FLOW.rest.brain / flowTotal;
    series.flowHeart[i] = BLOOD_FLOW.rest.heart / flowTotal;
    series.flowKidneys[i] = flowKidneys / flowTotal;
    series.flowGut[i] = flowGut / flowTotal;
    series.flowMuscle[i] = flowMuscle / flowTotal;
    series.stomachMl[i] = stomachMl;
    series.stomachKcal[i] = stomachKcal;
    series.gutKcal[i] = gutKcal;
    series.emptyingKcalPerMin[i] = energyRate;
    series.glucoseAbsorbMgMin[i] = absorbedGlucoseSystemicMg;
    series.carbAbsorbMgMin[i] = absorbedCarbsG * 1000;
    series.fatAbsorbGMin[i] = absorbedFatG;
    series.proteinAbsorbGMin[i] = absorbedProteinG;
    series.insulinSecretion[i] = secretion;
    series.liverGlycogen[i] = liverGlycogen;
    series.muscleGlycogen[i] = muscleGlycogen;
    series.fatStoredG[i] = fatStored;
    series.bladderMl[i] = bladder;
    series.kcalPerHour[i] = kcalPerHour;
    series.carbFuel[i] = carbFuel;
    series.fullness[i] = fullness;
    series.alertness[i] = alertness;
    series.drowsy[i] = drowsy;
    series.jitter[i] = jitter;
    series.hunger[i] = hunger;
    series.crash[i] = crash;
    series.muscleUptakeGMin[i] = toMuscleG;
    series.hepaticOutputGMin[i] = hepaticOutput;
    series.liverUptakeGMin[i] = toLiverG + liverDirectG;
    series.posture[i] = POSTURE_INDEX[posture];
    series.digestion[i] = digest;
    series.mealDip[i] = mealDip;
    series.sleepPressure[i] = sleepPressure;
    series.hoursAwake[i] = hoursAwake;
    series.caffeineFelt[i] = caffeineFelt;
    series.temperature[i] = BODY_TEMPERATURE.meanC + BODY_TEMPERATURE.swingC * Math.cos((2 * Math.PI * (hours - BODY_TEMPERATURE.peakHour)) / 24) + channels.temperature[i];
    series.stressLevel[i] = stress;
    series.inflammation[i] = Math.min(1, channels.inflammation[i]);
    series.immune[i] = Math.min(1, channels.immune[i]);
    series.reward[i] = Math.min(1, channels.reward[i]);
    series.fluidBalance[i] = -fluidDeficitMl;
    series.systolic[i] = RESTING_SYSTOLIC_MMHG + channels.bloodPressure[i] + CAFFEINE.bloodPressureGainMmHgPerMgL * caffeineMgL;
    series.muscleWork[i] = muscleWork[i];
    if (cycle) {
      const hormones = hormonesAt(cycle, t);
      series.cycleDay[i] = cycleDay(cycle, t);
      series.estradiol[i] = hormones.estradiol;
      series.progesterone[i] = hormones.progesterone;
      series.lh[i] = hormones.lh;
    }

    for (const k of tracks) {
      const o = i * LEDGER_SIZE;
      k.ledger[o] = k.stomachCarb * 4 + k.stomachFat * 9 + k.stomachProtein * 4;
      k.ledger[o + 1] = k.gutCarb * 4 + k.gutFat * 9 + k.gutProtein * 4;
      k.ledger[o + 2] = k.bloodGlucoseG * 4 + k.bloodFatG * 9 + k.bloodAminoG * 4;
      k.ledger[o + 3] = k.dest.liver;
      k.ledger[o + 4] = k.dest.muscle;
      k.ledger[o + 5] = k.dest.fat;
      k.ledger[o + 6] = k.dest.burned;
      k.ledger[o + 7] = k.dest.colon;
      const c = i * 4;
      k.caffeineLedger[c] = k.stomachCaffeine;
      k.caffeineLedger[c + 1] = k.gutCaffeine;
      k.caffeineLedger[c + 2] = k.caffeineBody;
      k.caffeineLedger[c + 3] = k.caffeineCleared;
      k.flows.set([k.stomachFat, k.gutFat, k.bloodFatG, k.fatCleared, k.carbsAbsorbedPerMin, k.fatAbsorbedPerMin, k.stomachAlcohol, k.gutAlcohol, k.alcoholAbsorbed], i * FLOW_SIZE);
    }
  }

  // Everything handed out starts at 00:00 today, so the lead-in is invisible to whoever reads it.
  return {
    scenario,
    anthro,
    series: Object.fromEntries(SERIES.map((name) => [name, series[name].subarray(leadIn)])) as Record<SeriesName, Float32Array>,
    intakeLedgers: new Map(tracks.map((k) => [k.intake.id, { ledger: k.ledger.subarray(leadIn * LEDGER_SIZE), caffeineMg: k.intake.caffeineMg, caffeineLedger: k.caffeineLedger.subarray(leadIn * 4), flows: k.flows.subarray(leadIn * FLOW_SIZE), alcoholG: k.intake.alcoholG }])),
    substances: new Map(substanceTracks.map((s) => [s.substance.id, { series: s.series.subarray(leadIn), ledger: s.ledger.subarray(leadIn * 3), substance: s.substance }])),
    events,
    channels: Object.fromEntries((Object.keys(channels) as ChannelId[]).map((id) => [id, channels[id].subarray(leadIn)])) as Record<ChannelId, Float32Array>,
    muscleEvents: [...(scenario.events ?? []), ...runSessions(activities)],
    cycle,
  };
}

function stomachKcalBefore(tracks: IntakeTrack[]) {
  return tracks.reduce((sum, k) => sum + k.stomachCarb * 4 + k.stomachFat * 9 + k.stomachProtein * 4 + k.gutCarb * 4 + k.gutFat * 9 + k.gutProtein * 4, 0);
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
