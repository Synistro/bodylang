import { Cycle, cycleDay, hormonesAt, lutealShare } from "./cycle";
import { activityBouts, BodyEvent, ChannelId, channelSeries, maxHeartRate, muscleWorkSeries, resolveEvent, ResolvedEvent, runSessions } from "./events";
import { ALCOHOL, BLOOD_FLOW, BODY_COMPOSITION, BODY_TEMPERATURE, CAFFEINE, COUPLING, CYCLE, DAY, ENERGY, FASTING, FEEL, GLUCOSE, GUT, HEART, INSULIN, KIDNEY, LIPID, LIVER, MUSCLE, PROTEIN, RESTING_SYSTOLIC_MMHG, STOMACH, SUBSTANCE_STEP, TRAINING } from "./params";

export type Sex = "male" | "female";
export type Posture = "sleeping" | "sitting" | "standing" | "walking" | "running";

export interface Body {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
}

export interface Nutrients {
  grams: number;
  waterMl: number;
  carbsG: number; // total carbohydrate including fiber, as on a US label
  sugarG: number;
  fatG: number;
  proteinG: number;
  fiberG: number;
  caffeineMg: number;
  alcoholG: number;
}

// Where what is in a food comes from: a row of the USDA table, or Claude's own estimate of it.
export type FoodSource = { kind: "table"; fdcId: number; name: string; dataset: string } | { kind: "estimate" } | { kind: "recipe"; ingredients: { fdcId: number; name: string; grams: number }[] };

// What one serving is, so a portion can be corrected in the units it was eaten in.
export interface Serving {
  label: string;
  grams: number;
}

export interface Intake extends Nutrients {
  id: string;
  label: string;
  at: number;
  liquid?: boolean;
  fructoseShare?: number; // of its sugar; table sugar is 0.5, whole fruit 0.6 to 0.67
  source?: FoodSource;
  serving?: Serving;
  portionBy?: "you"; // set once you have corrected it; until then the portion is Claude's estimate
}

export interface ActivitySpan {
  from: number;
  posture: Posture;
}

export const SUBSTANCE_ROUTES = ["swallowed", "inhaled", "injected"] as const;
export type SubstanceRoute = (typeof SUBSTANCE_ROUTES)[number];

// A substance the core model doesn't know about. Claude supplies the kinetics and says where
// the numbers come from, and the engine moves it through the body like caffeine.
export interface CustomSubstance {
  id: string;
  label: string;
  at: number;
  doseMg: number;
  tmaxMin: number;
  halfLifeH: number;
  volumeLPerKg: number;
  bioavailability: number;
  route?: SubstanceRoute; // how it gets in; swallowed if not said
  targets: { organ: OrganId; effect: string }[];
  source: string;
}

export type OrganId =
  | "brain"
  | "heart"
  | "lungs"
  | "liver"
  | "stomach"
  | "pancreas"
  | "spleen"
  | "small_intestine"
  | "large_intestine"
  | "kidneys"
  | "bladder"
  | "muscle"
  | "fat"
  | "uterus"
  | "ovaries"
  | "prostate";

export interface Scenario {
  body: Body;
  intakes: Intake[];
  activities: ActivitySpan[];
  substances: CustomSubstance[];
  events?: BodyEvent[];
  cycle?: Cycle | null;
}

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
  const leanKg = Math.min(BODY_COMPOSITION.maxLeanShare * b.weightKg, male ? 0.407 * b.weightKg + 0.267 * b.heightCm - 19.2 : 0.252 * b.weightKg + 0.473 * b.heightCm - 48.3);
  const bloodVolumeL = male ? 0.3669 * hM ** 3 + 0.03219 * b.weightKg + 0.6041 : 0.3561 * hM ** 3 + 0.03308 * b.weightKg + 0.1833;
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
    baselineGlucose: GLUCOSE.baselineMgDl + GLUCOSE.baselineAgeGain * Math.max(0, b.age - 40) + GLUCOSE.baselineBmiGain * Math.max(0, bmi - 25),
    baselineTg: LIPID.baselineMgDl + LIPID.baselineBmiGain * Math.max(0, bmi - 24),
    muscleGlycogenMaxG: leanKg * MUSCLE.glycogenPerKgLean,
  };
}

export const SERIES = [
  "glucose",
  "insulin",
  "insulinAction",
  "tg",
  "caffeine",
  "occupancy",
  "alcohol",
  "hr",
  "breaths",
  "cardiacOutput",
  "flowBrain",
  "flowHeart",
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
  "muscleUptakeGMin",
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
const LEDGER_SIZE = LEDGER_KEYS.length;

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
const FLOW_SIZE = FLOW_KEYS.length;

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
export const POSTURES: Posture[] = ["sleeping", "sitting", "standing", "walking", "running"];

// With nothing said about the night, the body goes to bed at the usual time. A span that starts
// later than that is someone saying they stayed up, so it wins.
export function postureAt(activities: ActivitySpan[], minute: number): Posture {
  let current: Posture = "sleeping";
  let currentFrom = -Infinity;
  for (const a of activities) {
    if (a.from <= minute) {
      current = a.posture;
      currentFrom = a.from;
    }
  }
  return minute >= DAY.sleepMin && currentFrom < DAY.sleepMin ? "sleeping" : current;
}

// The water alcohol spreads through, in litres.
export const alcoholVolumeL = (body: Body) => (body.sex === "male" ? ALCOHOL.widmarkMale : ALCOHOL.widmarkFemale) * body.weightKg;

// Fiber is not digested as carbohydrate. What reaches the colon is counted there.
export const availableCarbsG = (n: Nutrients) => Math.max(0, n.carbsG - n.fiberG);

// What a ledger tracks. Alcohol has a ledger of its own, in grams.
export const foodKcalOf = (n: Nutrients) => availableCarbsG(n) * 4 + n.proteinG * 4 + n.fatG * 9;

export const kcalOf = (n: Nutrients) => foodKcalOf(n) + n.alcoholG * 7;

// One MET is about 1 kcal per kg per hour, on top of resting burn for anything above rest.
export const postureKcalPerHour = (bmrKcalPerDay: number, weightKg: number, met: number) => bmrKcalPerDay / 24 + (met - 1) * weightKg;

// The drowsiness one meal causes at some minutes after eating it.
export function mealDipOf(kcal: number, sinceMin: number): number {
  if (sinceMin < 0 || kcal < 60) return 0;
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
  let muscleGlycogen = anthro.muscleGlycogenMaxG * 0.75;
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
      muscleGlycogen = anthro.muscleGlycogenMaxG * 0.75;
      fatStored = 0;
      fluidDeficitMl = 0;
      bladder = KIDNEY.bladderStartMl;
      lastFed = Math.max(lastFed, FASTING.assumedLastMealMin);
      if (stomachKcalBefore(tracks) <= 25) lastMealEnd = -Infinity;
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
      k.dest.colon += fiberOut * 2;
      waterAbsorbed += liquidOut * 0.9;

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
    if (bladder > KIDNEY.voidAtMl && posture !== "sleeping") bladder = 40;

    // Insulin and glucose: Bergman's minimal model, with an incretin term because oral glucose
    // releases more insulin than the same glucose by vein.
    const moving = Math.max(posture === "running" ? 1.5 : posture === "walking" ? 1 : 0, muscleWork[i] * COUPLING.afterglowPerMuscleWork);
    afterglow += (moving - afterglow) / (moving > afterglow ? INSULIN.afterglowRiseMin : INSULIN.afterglowDecayMin);
    const eventSensitivity = Math.max(COUPLING.lowestInsulinSensitivity, 1 + channels.insulinSensitivity[i]);
    const activityBoost = INSULIN.activityBoost[posture] * (1 + INSULIN.afterglowGain * afterglow) * eventSensitivity;
    if (stomachKcalBefore(tracks) > 25) lastFed = t;
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
    const liverAvailable = liverGlycogen > 5 ? 1 : 0.4;
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
    liverGlycogen = Math.min(LIVER.glycogenMaxG, Math.max(0, liverGlycogen + (toLiverG + liverDirectG * 0.7) * LIVER.glucoseToGlycogen - (hepaticOutput - exerciseMatchG) * LIVER.glycogenShareOfOutput * (liverGlycogen / (liverGlycogen + LIVER.glycogenSparingG)) - exerciseMatchG * LIVER.exerciseFromGlycogen * (liverGlycogen / (liverGlycogen + 5))));

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
    fatStored += toFatG * 0.35;

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

    digest += (Math.min(1, (stomachKcal + gutKcal * 1.3) / 600) - digest) / HEART.digestionEaseMin;
    if (stomachKcal > 25 || gutKcal > 25) lastMealEnd = t;

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
    const carbFuel = Math.min(0.95, ENERGY.carbFuelBase + ENERGY.carbFuelInsulinGain * insulinFraction + (posture === "running" ? 0.3 : 0) + trainingFuel);
    const burnPerMin = kcalPerHour / 60;
    const burnBudget = burnPerMin * carbFuel * 0.15;
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
    const drowsy = Math.min(1, Math.max(0, mealDip * (1 - caffeineFelt * 0.7) + circadianDip * 0.4 + sleepPressure * 0.6 + drowsiness - COUPLING.drowsyPerStress * stress));
    const alertness = Math.min(1, Math.max(FEEL.alertnessFloorAwake, FEEL.alertnessRested + caffeineFelt * 0.55 - circadianDip - sleepPressure - mealDip * 0.45 - COUPLING.alertnessPerDrowsiness * drowsiness + COUPLING.alertnessPerStress * stress + COUPLING.alertnessPerReward * channels.reward[i]));
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
    series.breaths[i] = HEART.breathsByActivity[posture] + digest * 1.5 + channels.breathing[i];
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
