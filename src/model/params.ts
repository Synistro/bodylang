import type { MuscleGroup } from "./muscleGroups";

// Every tunable number in the physiology model lives here, next to where it came from.
// Evidence: A = consistent human studies or official bodies, B = human studies with wide
// variation, C = our own estimate chosen to reproduce the shape of published curves.

export type Evidence = "A" | "B" | "C";

export const SOURCES = {
  caffeine: "EFSA Scientific Opinion on the safety of caffeine, 2015; half-life varies roughly 2 to 8 h between people",
  caffeineSleep: "Drake et al., J Clin Sleep Med 2013: 400 mg six hours before bed still cost about an hour of sleep",
  adenosine: "Elmenhorst et al., J Nucl Med 2012: PET of the A1 receptor in living humans, half blocked at 67 µM caffeine in plasma, about 13 mg/L",
  emptying: "Hunt & Stubbs, J Physiol 1975: the stomach empties at a roughly constant energy rate near 2 to 3 kcal/min",
  minimalModel: "Bergman et al., Am J Physiol 1979: minimal model of glucose and insulin dynamics",
  sitting: "Buffey et al., Sports Med 2022: light walking breaks lower the glucose rise after a meal more than standing",
  lipemia: "Lopez-Miranda et al., Atherosclerosis 2007: triglycerides peak 3 to 5 h after a fatty meal",
  bmr: "Mifflin et al., Am J Clin Nutr 1990: resting energy expenditure equation",
  leanMass: "Boer, Am J Physiol 1984: lean body mass from height and weight",
  bloodVolume: "Nadler et al., Surgery 1962: blood volume from height, weight and sex",
  alcohol: "Widmark 1932: distribution factor and near-constant elimination rate of alcohol",
  flow: "Matheson et al., J Surg Res 2000: review of intestinal blood flow when fasted and fed. Sidery et al., Am J Physiol 1991: gut artery flow up 87 to 122% within 45 min of a meal",
} as const;

export const STOMACH = {
  liquidHalfLifeMin: 12, // water alone
  liquidHalfLifeWithSolidsMin: 42,
  // Against Tougas et al., Am J Gastroenterol 2000: a 255 kcal low-fat meal is 69% retained at 1 h,
  // 24% at 2 h and 1% at 4 h (upper limits 90, 60, 10). These give about 60, 15 and 0, inside the
  // range and a little quick, chosen so whole fruit and rice also land on their published responses.
  solidLagMin: 20,
  sugaryDrinkRateGain: 1.2, // sweet liquids skip the lag and leave a little faster than solid food
  energyRateKcalPerMin: 1.5,
  energyRateSizeGain: 0.005, // Hunt & Stubbs 1975: bigger meals leave faster in absolute terms
  // Benini et al., Gut 1995: 20 g against 4 g of fibre per 1000 kcal lengthened emptying 232 against
  // 186 min, about 0.015 per g. Taken at 0.008 because 0.015 drops an apple's response below its
  // published glycemic index of 36 to 44. My judgement within that range.
  fibreSlowdownPerGPer1000Kcal: 0.008,
  fatSlowdown: 0.42, // at 100 % of energy from fat
  walkSpeedup: 0.15,
  // Neufer 1989: running at 74% of VO2max emptied less than running at 57% or 65%. Maughan and Rehrer
  // 1994: little effect up to 70 to 75%. The direction is published, and the size is my estimate.
  hardRunSlowdown: 0.25,
  secretionMlPerKcal: 0.28,
  restingVolumeMl: 45,
  fullnessMl: 1000,
  slowWavesPerMin: 3,
} as const;

export const GUT = {
  carbRatePerMin: 0.08, // fitted to the 75 g glucose test: peak near 40 min
  fatRatePerMin: 0.0115,
  proteinRatePerMin: 0.016,
  waterRatePerMin: 0.09,
  caffeineRatePerMin: 0.11,
  alcoholRatePerMin: 0.05,
  carbBioavailability: 0.97,
  fatBioavailability: 0.95,
  proteinBioavailability: 0.9,
} as const;

export const GLUCOSE = {
  baselineMgDl: 88,
  baselineAgeGain: 0.1, // per year above 40
  baselineBmiGain: 0.45, // per BMI point above 25
  distributionDlPerKgLean: 2.15,
  distributionFatShare: 0.2,
  effectiveness: 0.017, // Sg, 1/min
  systemicShare: 0.74, // absorbed glucose that passes the liver on first pass
  fructoseShare: 0.5, // of sugar, as in table sugar. Whole fruit runs 0.6 to 0.67; an intake can say so
  fructoseToLiver: 0.9,
  brainUseGPerMin: 0.1,
  hepaticOutputGPerMinPerKg: 0.0019,
  hepaticSuppression: 0.8,
  insulinEffectUpper: 30, // µU/mL above baseline for full hepatic suppression
  muscleShare: 0.68,
  liverShare: 0.2,
  fatShare: 0.12,
  // Trefts et al. 2015: exercise would cause hypoglycemia without the liver's accelerated glucose
  // release. The share is my estimate, set so a fasted walk stays within about 0.3 mmol/L.
  exerciseHepaticMatch: 0.97,
  // Insulin only partly holds that back: exercise lowers insulin and raises glucagon. Set so a run 2 h
  // after breakfast bottoms out near 4.5 mmol/L. My estimate.
  exerciseLiverInsulinBrake: 0.3,
  // A floor to keep the arithmetic safe, below the 3.0 mmol/L a reading can call very low.
  floorMgDl: 50,
} as const;

export const INSULIN = {
  baselineUUPerMl: 8,
  clearancePerMin: 0.11,
  glucoseGain: 0.075,
  firstPhaseGain: 0.4,
  incretinGain: 0.0024, // per mg/min of glucose appearing from the gut
  proteinGain: 0.02,
  actionDecayPerMin: 0.028, // p2
  sensitivity: 8.5e-4, // SI, dL/(µU*min)
  sensitivityRefBmi: 22,
  sensitivityBmiPower: 1.25,
  sensitivityAgeLoss: 0.004, // per year above 30
  femaleBonus: 1.08,
  activityBoost: { sleeping: 0.9, sitting: 0.85, standing: 1, walking: 1.45, running: 1.7 },
  // Adrenaline holds the pancreas back during effort, so insulin falls even with food on board.
  // Nygaard 2009: a brisk walk after a meal cut the insulin response by 8 to 17%. The size at a hard
  // run is my estimate; the direction is standard exercise physiology.
  exerciseBrake: { sleeping: 0, sitting: 0, standing: 0, walking: 0.15, running: 0.75 },
  exerciseBrakePerMuscleWork: 1.2,
  exerciseBrakeMost: 0.85,
  exerciseBasalFall: 0.5, // how much of that brake also lowers insulin's resting level while it lasts
  resistanceCompensationPower: 0.3,
  afterglowGain: 0.5, // muscles stay more sensitive to insulin for a while after moving
  afterglowRiseMin: 15,
  afterglowDecayMin: 160,
} as const;

export const LIVER = {
  glycogenStartG: 85,
  glycogenShareOfOutput: 0.45, // the rest of fasting glucose output comes from gluconeogenesis
  glycogenSparingG: 22,
  glycogenMaxG: 110,
  glucoseToGlycogen: 1,
  exerciseFromGlycogen: 0.85, // of the extra sugar released for working muscle; the rest is newly made. My estimate
} as const;

export const MUSCLE = {
  glycogenPerKgLean: 5.6,
  // Set so whole-body glucose disposal fits a moderate run, net of what muscle burns from its own glycogen.
  uptakeGPerMinByActivity: { sleeping: 0, sitting: 0, standing: 0.02, walking: 0.2, running: 0.6 },
  glycogenBurnGPerMinByActivity: { sleeping: 0.005, sitting: 0.005, standing: 0.005, walking: 0.15, running: 1.3 },
} as const;

export const LIPID = {
  baselineMgDl: 96,
  baselineBmiGain: 3.5,
  plasmaDlPerKg: 0.42,
  // Kolovou et al. 2011: the standard fat test is 75 g of fat, and a reading up to 220 mg/dL is desirable.
  // These put a healthy man near 200 at 4 h, back near base by about 10 h.
  clearancePerMin: 0.055,
  insulinClearanceBoost: 0.02,
  adiposeShare: 0.82,
} as const;

export const PROTEIN = { liverShare: 0.5, muscleShare: 0.25, burnedShare: 0.25, bloodTurnoverPerMin: 0.03 } as const;

export const CAFFEINE = {
  halfLifeH: { low: 3, mid: 5, high: 7.5 },
  volumeLPerKg: 0.65,
  receptorA1Ic50Um: 67, // Elmenhorst 2012, plasma level at half-maximal A1 occupancy by PET
  // How much a dose is felt, a separate scale from receptors blocked: half effect near 100 mg in an
  // 80 kg body, tuned so one cup is clearly felt and two cups approach jitters. My estimate.
  feltHalfEffectMgL: 1.94,
  molarMgPerLToUm: 5.15,
  feltAboveMgL: 0.9,
  sleepConcernMgL: 0.8,
  bloodPressureGainMmHgPerMgL: 1.3,
  kidneyShare: 0.03,
} as const;

export const ALCOHOL = {
  widmarkMale: 0.68,
  widmarkFemale: 0.55,
  eliminationGPerLPerH: 0.15,
  eliminationKmGPerL: 0.1, // saturable: nearly constant when drunk, slower once blood levels are low
  // Ramchandani et al. 2001: elimination 25 to 45% faster an hour after a meal.
  foodEliminationGain: 0.3,
  foodEffectFullFromDigestion: 0.3,
} as const;

export const HEART = {
  restBpmMale: 66,
  restBpmFemale: 71,
  bmiGain: 0.5,
  // Walking and running add to the sitting rate through ACTIVITY, so they can ease off after stopping.
  byActivity: { sleeping: -9, sitting: 2, standing: 9, walking: 2, running: 2 },
  digestionGain: 9,
  // Sidery 1991: gut artery flow up 87% by 15 min after a meal, cardiac output up by 30 min.
  digestionEaseMin: 15,
  caffeineGainPerMgL: 0.6,
  strokeVolumeMlPerKgLean: 1.25,
  // The heart squeezes out more per beat during effort. Zhou 2001: in untrained people it levels off
  // near 40% of VO2max, though Vella and Robergs 2005 report it can keep rising. A 50% rise gives about
  // 18 L/min on a run burning 2.4 L of oxygen a minute, matching the usual 5 L/min per L of oxygen.
  strokeExerciseGain: 0.5,
  strokePlateauReserveShare: 0.4,
  strokeEaseMin: 3,
  strokeWorkingFromMuscleFlow: 0.02,
  breathsByActivity: { sleeping: 11, sitting: 13, standing: 14, walking: 13, running: 13 },
} as const;

// The day's rhythm: lowest near 6 AM, highest near 5 PM (Mackowiak 1992).
export const BODY_TEMPERATURE = { meanC: 36.6, swingC: 0.25, peakHour: 17 } as const;

export const RESTING_SYSTOLIC_MMHG = 118;

// Share of cardiac output at rest, then what digesting and moving add.
export const BLOOD_FLOW = {
  rest: { brain: 0.14, heart: 0.05, kidneys: 0.2, gut: 0.25, muscle: 0.19, skin: 0.07, other: 0.1 },
  digestionGutGain: 0.13,
  activityMuscleGain: { sleeping: -0.03, sitting: -0.03, standing: 0.02, walking: 0.4, running: 0.85 },
  // Moving sends blood away from gut and kidneys. ter Steege 2012: splanchnic flow can fall by 80% or
  // more with long or hard exercise. The walking figure is my estimate. Muscle then takes about 70%
  // of a hard run's output, the usual teaching figure.
  activityGutKidneyCut: { sleeping: 0, sitting: 0, standing: 0, walking: 0.25, running: 0.8 },
} as const;

export const ENERGY = {
  mets: { sleeping: 0.95, sitting: 1.3, standing: 1.6, walking: 3.3, running: 8.5 },
  thermicShare: 0.1,
  carbFuelBase: 0.38,
  carbFuelInsulinGain: 0.5,
} as const;

export const KIDNEY = {
  urineMlPerMin: 0.35, // the least the kidneys can make, about 500 ml a day; anything drunk comes on top
  insensibleMlPerMin: 0.5, // skin and breath, net of the water metabolism makes. Ratnatunga 1991 measured 1 to 1.2 L a day gross
  // ICS 2002, via Hofmeester 2015: a healthy young adult makes at most 20% of the day's urine in the
  // third of the day spent asleep, which is half the waking rate.
  sleepingUrineFactor: 0.5,
  waterExcretionRatePerMin: 0.012,
  voidAtMl: 380,
  // A healthy bladder holds some urine at the start of the simulated day.
  bladderStartMl: 160,
} as const;

export const FEEL = {
  postMealDipPeakMin: 80,
  // Scale chosen so a normal day reads about 40 at 14:30 and 43 at 20:30. My estimate.
  postMealDipStrength: 0.2,
  postMealDipFullKcal: 900,
  circadianDipHour: 14.5,
  circadianDipWidthH: 2.2,
  circadianDipDepth: 0.14,
  sleepPressurePerHour: 0.016,
  alertnessRested: 0.76,
  alertnessFloorAwake: 0.05, // nobody awake reads as nothing
  // Daan, Beersma and Borbely 1984: sleep pressure falls with a time constant of 4.2 h asleep.
  sleepPressureDecayTauH: 4.2,
  hungerAfterEmptyMin: 150,
  // Scheer et al., Obesity 2013: hunger is at its daily low near 8 AM despite the overnight fast.
  hungerOnWaking: 0.25,
  hungerFastingFullMin: 300,
  hungerPlateau: 0.85, // a long fast stops getting hungrier
  jitterFromCaffeineFelt: 0.62,
  // Felt only once sugar is actually low: ADA level 1 is 70 mg/dL, level 2 is 54 mg/dL.
  lowSugarFeltFromMgDl: 72,
  lowSugarFullAtMgDl: 54,
} as const;

// A day without food: glucose eases down and insulin falls. Wijngaarden 2014 reports the fall in
// insulin without a size I could use, so both sizes here are estimates.
export const FASTING = {
  assumedLastMealMin: -270, // dinner at 19:30 the evening before
  driftStartsAfterH: 12,
  driftFullAfterH: 28,
  glucoseDropMgDl: 9,
  insulinDropShare: 0.4,
} as const;

export const DAY = {
  minutes: 30 * 60, // the simulation runs into the next morning so forecasts never hit a wall
  wakeMin: 7 * 60 + 30,
  sleepMin: 23 * 60 + 30,
  rolloverMin: 4 * 60, // a new day starts here, so a late night still belongs to the day it began in
  carryDaysMost: 2, // how many days back the simulation may run first
  stillUpMin: 30, // after you last said something past bedtime, how long you are taken to stay up
  intakeCarryDays: 1,
  substanceCarryDays: 2,
  eventCarryDays: 14,
} as const;

// A typical menstrual cycle. Each hormone is a smooth curve in days from ovulation, drawn by hand to
// pass through the medians Stricker 2006 measured daily in 20 women, with the day of ovulation taken as
// 14 days before the next period. Real cycles vary a lot more than one curve can show.
export const CYCLE = {
  lengthDays: 28,
  periodDays: 5,
  lutealDays: 14,
  aroundOvulationDays: 1,
  hormones: {
    estradiol: { base: 120, ovulatory: { amount: 900, atDay: -1, widthDays: 1.6 }, luteal: { amount: 350, atDay: 7, widthDays: 3.2 } }, // pmol/L
    progesterone: { base: 0.6, luteal: { amount: 42, atDay: 7, widthDays: 3 } }, // nmol/L
    lh: { base: 5, surge: { amount: 40, atDay: -0.5, widthDays: 0.7 } }, // IU/L
  },
  // At the height of the luteal phase. Temperature: 0.28 to 0.56 °C is the reported rise. Heart: a review
  // of digital tools reports 2.7 to 3.9 bpm. Insulin: BioCycle (Yeung 2010) HOMA-IR 1.35 to 1.59, read here
  // as sensitivity 15% lower, though other studies find no change. Metabolism: Benton 2020 finds a small
  // rise (effect size 0.33), which I put at 3%. Appetite is my estimate.
  luteal: { temperatureC: 0.35, heartBpm: 3, insulinSensitivity: -0.15, metabolism: 0.03, appetite: 0.1 },
  cramps: { amount: 0.5, fadeDays: 1.6 }, // my estimate of how it feels for many people, and it varies widely
  lining: { least: 0.2, atOvulation: 0.75 }, // of its full thickness; the shape is standard, the numbers my estimate
  namedFrom: { warmthC: 0.15, heartBpm: 1.5 },
  scale: { estradiol: { min: 0, max: 1400, low: 100, high: 1300 }, progesterone: { min: 0, max: 60, low: 0.3, high: 50 } },
  evidence: "B" as Evidence,
  source:
    "A typical cycle placed by the date you gave, so your real days may differ, and it can't be used for contraception. Hormones: Stricker et al., Clin Chem Lab Med 2006, daily medians from 20 women. Luteal changes: Yeung 2010 (BioCycle), Benton 2020",
};

// The typical ranges every reading is judged against, with where each one comes from. Thresholds
// the interface shows as "My estimate" have no published standard and carry evidence C.
export const REFERENCE = {
  mgDlPerMmolGlucose: 18.016,
  // ADA counts fasting from 8 h without calories.
  fastingAfterMin: 480,
  fedAfterFoodMin: 180,
  stillDigestingKcal: 10,
  trendWindowMin: 5,
  headingHorizonMin: 300,
  eventHeartDrivenFromBpm: 3,
  glucose: {
    fasting: { low: 3.9, high: 5.6, label: "3.9 to 5.6 mmol/L fasting" },
    afterMeal: { low: 3.9, high: 7.8, label: "3.9 to 7.8 mmol/L after a meal" },
    fastingHighMmol: 7.0,
    afterMealHighMmol: 11.1,
    veryLowMmol: 3.0,
    // The clinical cutoff is read two hours after a glucose drink. Above it in the first 90 min is
    // an ordinary peak: Shah 2019 finds healthy people there about 2% of the day.
    mealWindowMin: 120,
    peakWindowMin: 90,
    // Wyatt 2021: dips below your starting level 2 to 3 hours after food are common in healthy people.
    // Where such a dip stops being ordinary is my estimate.
    dip: { windowMin: 300, floorMmol: 3.5 },
    stillAbsorbingMgPerMin: 30,
    scale: { min: 3, max: 11 },
    evidence: "A",
    source: "ADA Standards of Care: fasting under 5.6 mmol/L, under 7.8 two hours after 75 g glucose, under 3.9 is low. Shah et al., JCEM 2019: healthy people spend 96% of the day between 3.9 and 7.8. Wyatt et al., Nat Metab 2021: dips 2 to 3 h after food are common",
  },
  insulin: {
    fastingUUPerMl: { low: 2.1, high: 12.5 },
    fastingRaisedFold: 1.6,
    fastingHighFold: 2.5,
    settlingHighFold: 2.5,
    // Above the 110 µU/mL ceiling the model's 75 g glucose test is held to.
    afterFoodHighFold: 14,
    atRestBelowFold: 1.15,
    loweredBelowFold: 0.85,
    scale: { min: 0, max: 12 },
    afterFoodTypicalFold: { low: 1, high: 10 },
    fastingEvidence: "B",
    fastingSource: "Tehran Lipid and Glucose Study, 5,786 adults: 95% of fasting values fell between 2.1 and 12.5 µU/mL. Assays differ between labs",
    afterFoodEvidence: "C",
    afterFoodSource: "My estimate. No standard range exists after food; the fold is relative to the model's resting level",
  },
  triglycerides: {
    fastingHigh: 150,
    fastingVeryHigh: 200,
    nonFastingHigh: 175,
    retestAbove: 440,
    // A fatty meal keeps blood fat up for several hours.
    fatWindowMin: 600,
    fatMealG: 5,
    arrivedAboveRestMgDl: 15,
    clearingAboveRestMgDl: 5,
    scale: { min: 0, max: 300 },
    evidence: "A",
    source: "Nordestgaard et al. (EAS, EFLM), Eur Heart J 2016: flag at 175 mg/dL non-fasting, 150 fasting, retest fasting above 440. NCEP ATP III 2001: 200 fasting is high",
  },
  heart: {
    low: 60,
    high: 100,
    raisedAboveOwnRestBpm: 4,
    nearMaximumShare: 0.95,
    scale: { min: 40, max: 180 },
    evidence: "A",
    source: "Cleveland Clinic and MedlinePlus (NIH): 60 to 100 bpm at rest for adults. Fit people can sit lower",
  },
  cardiacOutput: {
    male: { low: 3.5, high: 8.2 },
    female: { low: 3.3, high: 7.3 },
    raisedAboveOwnRestL: 0.3,
    scale: { min: 2, max: 20 },
    evidence: "A",
    source: "Normative reference values of cardiac output by Doppler echocardiography, 3,090 adults (PMID 33144167)",
  },
  breathing: {
    low: 12,
    high: 20,
    scale: { min: 6, max: 40 },
    evidence: "A",
    source: "MedlinePlus (NIH): 12 to 20 breaths a minute at rest for adults",
  },
  // Percent of the blood the heart pumps, at rest.
  bloodFlow: {
    gut: { low: 20, high: 30, max: 50 },
    muscle: { low: 15, high: 20, max: 80 },
    brain: { low: 12, high: 15, max: 25 },
    kidneys: { low: 18, high: 22, max: 30 },
    digestingAbovePercent: 28,
    evidence: "B",
    source: "Vander, Human Physiology, via BioNumbers 109465: kidneys and muscle about 20% at rest. Physiology teaching figures: gut about 25%, brain 13 to 15%. Exact shares vary by study",
  },
  stomach: {
    fastingHighMlPerKg: 2.3,
    emptyAboveRestingMl: 15,
    veryFullMl: 800,
    evidence: "B",
    source: "Perlas et al. 2024, patient-level meta-analysis: fasting volume median 0.6 ml/kg, 95th percentile 2.3 ml/kg. The 1 L upper end is my estimate",
  },
  absorption: {
    high: 60,
    fatShownAboveGPerH: 1,
    scale: { min: 0, max: 90 },
    evidence: "B",
    source: "Jeukendrup: the gut's glucose carrier saturates near 60 g an hour",
  },
  liverGlycogen: {
    low: 40,
    high: 80,
    scale: { min: 0, max: 110 },
    lunchFromMin: 11 * 60,
    lunchUntilMin: 15 * 60,
    lunchKcal: 100,
    evidence: "B",
    source: "Taylor et al., J Clin Invest 1996: 207 mmol/L fasting, 316 after a meal. That is about 50 g and 77 g in a 1.5 L liver. The 40 g floor is my estimate",
  },
  muscleUptake: {
    highAtRestGPerH: 20,
    scale: { min: 0, max: 100 },
    quietBelowGPerH: 0.5,
    evidence: "C",
    source: "My estimate",
  },
  burn: {
    thermicNoticedKcal: 5,
    scale: { min: 0, max: 1000 },
    evidence: "B",
    source: "Mifflin et al., Am J Clin Nutr 1990 for resting burn. Compendium of Physical Activities (Ainsworth et al.) for the cost of each posture",
  },
  fuel: {
    low: 33,
    high: 67,
    scale: { min: 0, max: 100 },
    evidence: "B",
    source: "Miles-Chan et al., Int J Obes 2015: fasting respiratory quotient 0.80 to 0.90 depending on diet, which is about a third to two thirds of energy from carbs",
  },
  caffeine: {
    singleDoseMg: 200,
    dailyDoseMg: 400,
    presentAboveMgL: 0.01,
    scaleMaxMgL: 10,
    evidence: "A",
    source: "EFSA 2015: up to 200 mg at once and 400 mg a day raise no safety concern in healthy adults. Converted to blood level with this body's size",
  },
  receptors: {
    high: 50,
    clearBelowPercent: 1,
    evidence: "B",
    source: "Elmenhorst et al., J Nucl Med 2012: the A1 receptor measured by PET in 15 men, half blocked at about 13 mg/L, up to 50% with repeated cups",
  },
  alertness: {
    low: 30,
    high: 85,
    evidence: "C",
    source: "My estimate",
  },
  alcohol: {
    limitGPerL: 0.5,
    riskGPerL: 0.4,
    newDriverLimitGPerL: 0.2,
    presentAboveGPerL: 0.005,
    scaleMaxGPerL: 1.5,
    evidence: "A",
    source: "WHO: best-practice drink-driving limit 0.5 g/L, 0.2 g/L for new drivers, crash risk rises significantly from 0.4 g/L. Widmark 1932 for the clearing rate",
  },
  bladder: {
    firstDesireMl: 250,
    strongDesireMl: 400,
    capacityMl: 480,
    evidence: "B",
    source: "International Consultation on Incontinence, as summarised in urodynamics references: first desire near 250 ml, strong desire near 400 ml, capacity near 480 ml. Small samples",
  },
  temperature: {
    low: 36.1,
    high: 37.2,
    feverC: 38,
    dangerC: 39.5,
    scale: { min: 35.5, max: 41 },
    evidence: "A",
    source: "Obermeyer et al., BMJ 2017: mean 36.6 C in 35,488 people. MedlinePlus (NIH): a mouth reading above 37.2 to 37.5 C probably means fever. Mackowiak et al., JAMA 1992: daily swing about 0.5 C",
  },
  stressLevel: {
    high: 30,
    evidence: "C",
    source: "My estimate of a scale from 0 to 100. Wiesli et al., Diabetes Care 2005 for what a stress test does to the heart",
  },
  inflammation: {
    high: 20,
    evidence: "C",
    source: "My estimate of a scale from 0 to 100. Whole-body signalling has no single everyday measure",
  },
  immune: {
    high: 20,
    evidence: "C",
    source: "My estimate of a scale from 0 to 100",
  },
  reward: {
    high: 100,
    evidence: "C",
    source: "My estimate of a scale from 0 to 100. Carmichael et al. 1987 and Kruger et al. 2002 for the hormones",
  },
  fluid: {
    noticeableShareOfWeight: 0.01,
    impairingShareOfWeight: 0.02,
    evidence: "B",
    source: "Sawka et al., ACSM position stand 2007: a water deficit above 2% of body weight compromises performance. The 1% thirst point is my estimate",
  },
  bloodPressure: {
    typicalLow: 90,
    high: 120,
    raised: 140,
    danger: 180,
    scale: { min: 80, max: 200 },
    evidence: "C",
    source: "AHA: under 120 mmHg systolic is normal. The model does not measure you, so your resting 118 is my estimate; only the rises come from studies",
  },
  muscleState: {
    workingFrom: 0.1,
    soreFrom: 0.15,
    tiredFrom: 0.15,
    repairingFrom: 0.1,
    verySoreFrom: 0.8,
    normalWithinDays: 14,
    evidence: "B",
    source: "Cheung et al., Sports Med 2003 for soreness timing. Phillips et al. 1997 for repair. Moran-Navarro et al. 2017 for recovery",
  },
} as const;

// How the model's feeling scales become words, and when a feeling is worth mentioning.
export const FEELING_DISPLAY = {
  negligibleBelow: 0.12,
  mostShown: 3,
  loggedOutranksBy: 0.3,
  mostEmphasised: 3,
  toneOutweighsLevel: 2, // something needing attention beats any amount of ordinary activity
  mildFrom: 0.25,
  moderateFrom: 0.5,
  strongFrom: 0.75,
  changeShownAbove: 0.12,
  changeWindowMin: 30,
  warmFlowFrom: 0.27,
  warmFlowFull: 0.42,
  warmMax: 0.6, // digesting warms you mildly even at its strongest
  alertAbove: 0.6,
  earlyInDayH: 4,
  peakHorizonMin: 300,
} as const;

// How numbers become markers and line weight on a process drawn through the body.
// The day chart along the bottom: what it draws, and when it calls something over.
export const LANES = {
  from: DAY.rolloverMin,
  to: 28 * 60,
  stepMin: 5,
  // A curve that barely changes all day should look flat, so it gets at least this share of its value as vertical range.
  leastRangeShare: 0.06,
  nothingLeftBelowShareOfPeak: 0.1, // a low this far under a curve's peak counts as empty, such as a stomach's resting volume
  ghostShownAboveShare: 0.01, // a what-if has to move a reading by this much for your real day to be drawn beside it
  levelMarginShare: 0.08, // room above and below a reading's line, so it never touches the edge of its lane
  foodDigestedBelowShare: 0.03, // of what was eaten, still in the stomach or intestine
  doseGoneBelowShareOfPeak: 0.1,
  stopClearBelowShareOfPeak: 0.05,
  stopWorthALaneFrom: 0.04, // of the thing, at its fullest here
  eventLookaheadDays: 14,
  eventLookaheadStepMin: 30,
  // How much of the day the chart shows by itself: what is going on now, from where it began to where it ends.
  fit: { pastMin: 180, aheadMin: 240, marginMin: 15, leastSpanMin: 360, overBelowShare: 0.05 }, // over: how little counts as gone when a forecast lands there
  stillBelowShare: 0.1, // a reading moving less than this share of its row across the shown stretch has nothing to draw
  aheadMost: 3, // what comes next, when nothing is moving
  // A muscle's recovery runs for days: how finely it is drawn, and how much is shown around it.
  days: { stepMin: 30, marginShare: 0.03, tailShare: 0.2, storyMarginShare: 0.06, leastStoryMin: 720 },
} as const;

export const PROCESS = {
  // Under this a caffeinated drink counts as a drink, the way a splash of milk does in coffee.
  drinkOnlyBelowKcal: 30,
  finishedBelowShare: 0.03,
  stomachHereAboveShare: 0.1,
  intestineHereAboveShare: 0.05,
  firstArrivalShare: 0.005,
  presentShare: 0.01,
  fatHeavyShare: 0.2, // of a food's energy, enough for fat to slow the stomach noticeably
  sugarExcessFullMgDl: 60,
  insulinStartingFold: 1.5,
  mealPullsAlertnessAbove: 0.08,
  contributorShare: 0.15,
  heldInStomachShare: 0.02,
  arrivingAboveGPerMin: 0.02,
  mostlyInStomachShare: 0.85,
  stillInStomachShare: 0.3,
  sameSittingMin: 10, // eaten this close together, it reads as one thing
  reasonWordsMost: 10,
  sentenceWordsUnder: 14,
  stomachStillBelowKcalPerMin: 0.05,
  lastOfMealShare: 0.3, // less of the meal than this left in the gut reads as the last of it
  coolingNamedFromC: 0.1,
  movingNamedFromMmHg: 1,
  liftedFrom: 0.2,
  sorenessPeakMin: 48 * 60,
  threadOverBelow: 0.05,
  threadSoreFrom: 0.3,
  stressAttentionFrom: 0.3,
  feverNamedFromC: 0.2,
  eventLineLeastFlow: 0.25,
  stopFadedBelowShare: 0.02,
  caffeineWorkingAboveFelt: 0.05,
  sleepyNamedFrom: 0.25,
  stillWorkingAboveFelt: 0.15,
  eventDrowsinessNamedFrom: 0.08,
  flowWindowMin: 2,
  arrivingWindowMin: 30,
  swallowedForMin: 2,
  insulinActiveAboveFold: 1.15,
  sugarLeavingAboveGPerH: 1,
  fatRouteActiveAboveG: 1,
  clearingActiveAboveMgL: 0.1,
  clearingActiveAboveGPerL: 0.01,
  sleepPressureFullH: 16,
  // The rate drawn at full line weight.
  fullFlow: {
    kcalPerMin: 5,
    caffeineMgPerMin: 4,
    clearedMgPerMin: 0.5,
    alcoholGPerMin: 0.5,
    substanceMgPerMin: 5,
    sugarGPerMin: 0.6,
    insulinSecretion: 5,
    fatGPerMin: 0.2,
    bloodLPerMin: 3,
    heartLPerMin: 8,
    urineMlPerMin: 3,
  },
} as const;

// How events reach the rest of the model, beyond plain addition and multiplication.
export const COUPLING = {
  // Allen 2014 and Mistiaen 2002 (dogs) show stress slows the stomach and shifts gut function. The
  // sizes are my estimates.
  stressSlowsEmptying: 0.4,
  stressCutsGutFlow: 0.3,
  alertnessPerStress: 0.25,
  alertnessPerDrowsiness: 0.6,
  alertnessPerReward: 0.05,
  drowsyPerStress: 0.3,
  lowestInsulinSensitivity: 0.1,
  trainingCarbFuelGain: 0.3,
  trainingFuelFullFromWork: 0.1,
  afterglowPerMuscleWork: 1.5,
} as const;

// Every event curve below is a value at full strength. Rise and half-life are in minutes.
export const TRAINING = {
  maxHeartRate: { intercept: 208, perYearOfAge: 0.7 }, // Tanaka 2001
  // Share of heart rate reserve. Lifting runs lower than cardio over a whole session, with rests
  // between sets: about 120 bpm at intensity 0.8 for a man of 30. My estimate.
  heartReserve: { atZero: 0.15, gain: 0.35 },
  heart: { riseMin: 5, halfLifeMin: 4 },
  // 2011 Compendium: 3.5 for mixed sets of 8 to 15 reps, 6.0 for vigorous lifting.
  mets: { light: 3.5, hard: 6 },
  defaultMinutes: 60,
  breathing: { atZero: 6, gain: 14, riseMin: 3, halfLifeMin: 4 },
  // Gleeson 1998: strenuous exercise raises core temperature. A gym session at about 1 C is my estimate.
  temperature: { gain: 1, riseMin: 20, halfLifeMin: 25 },
  // MacDougall 1985 saw peaks of 255 to 320 mmHg within a lift. A minute's average is far lower; my estimate.
  systolic: { atZero: 20, gain: 30, riseMin: 3, halfLifeMin: 5 },
  stress: { atZero: 0.15, gain: 0.35, riseMin: 5, halfLifeMin: 20 },
  reward: { gain: 0.25, riseMin: 20, halfLifeMin: 60 },
  // Barnes 2019: 0.83 to 1.51 L/h across team and endurance sports. Lifting sits lower; my estimate.
  sweatMlPerMin: { atZero: 3, gain: 9, riseMin: 10, halfLifeMin: 10 },
  // Matches the model's walking and running gains in BLOOD_FLOW.
  muscleFlow: { atZero: 0.15, gain: 0.25, riseMin: 3, halfLifeMin: 6 },
  uptakeGPerMinFullBody: 0.8,
  glycogenGPerMinFullBody: 1.8,
  tired: { atZero: 0.2, gain: 0.5, riseMin: 10, halfLifeMin: 240 },
  evidence: "B",
  source: "Tanaka et al. 2001 for maximum heart rate. 2011 Compendium for METs. Cheung et al. 2003 for soreness. Phillips et al. 1997 for repair",
} as const;

// Roughly where skeletal muscle sits in the body. My estimate, used to scale whole-body sugar use.
export const MUSCLE_MASS_SHARE: Record<MuscleGroup, number> = {
  chest: 0.07,
  back: 0.14,
  shoulders: 0.06,
  biceps: 0.04,
  triceps: 0.05,
  forearms: 0.05,
  abs: 0.07,
  glutes: 0.12,
  quads: 0.17,
  hamstrings: 0.13,
  calves: 0.1,
};

export const MUSCLE_RECOVERY = {
  workFallHalfLifeMin: 4,
  fatigueRiseMin: 30,
  // Moran-Navarro 2017: recovery runs 24 to 48 h after hard sets, which a 12 h half-life matches.
  fatigueHalfLifeH: 12,
  // A curve (t/peak)^shape * exp(shape * (1 - t/peak)), peaking 48 h after the session. It gives
  // little by 12 h, is well along by 24 h, still high at 72 h and nearly gone by day 7, which is
  // the timing reported for delayed onset soreness.
  sorenessPeakH: 48,
  sorenessShape: 3,
  // Phillips 1997: protein synthesis above rest by 112% at 3 h, 65% at 24 h, 34% at 48 h.
  repairRiseMin: 60,
  repairHalfLifeH: 26,
  // Robergs 1991: six sets used about 47 mmol/kg of glycogen, with 22 back within 2 h unfed.
  glycogenUsedAtFull: 0.35,
  glycogenRefillHalfLifeMin: 180,
  activeAbove: 0.05,
} as const;

export const ILLNESS = {
  // Karjalainen and Viitasalo 1986: mean 38.4 C in acute febrile infection.
  feverAtFullC: 2,
  heartBpmPerC: 8.5, // Karjalainen and Viitasalo 1986, heart rate stayed up even in sleep
  heartAtFullWithoutFever: 3, // my estimate
  metabolismPerC: 0.1, // Manthous 1995: energy use fell about 10% per degree when febrile patients cooled
  breathsPerC: 2, // my estimate
  fluidMlPerMinPerC: 0.15, // my estimate
  // Yki-Jarvinen 1989: insulin action 52% lower in acute infections, still lower 1 to 3 months later.
  insulinSensitivityAtFull: -0.52,
  insulinRecoveryHalfLifeMin: 4320,
  // Langhans 2000 describes the anorexia of infection. Its size, and the rest below, are my estimates.
  appetiteAtFull: -0.6,
  drowsinessAtFull: 0.35,
  drowsinessWithFatigueAtFull: 0.5,
  stressAtFull: 0.25,
  immuneAtZero: 0.3,
  immuneGain: 0.7,
  inflammationAtFull: 0.8,
  rise: { fever: 240, heart: 240, immune: 240, inflammation: 360, sensitivity: 360, slow: 120 },
  halfLife: { fever: 360, heart: 360, immune: 2880, inflammation: 1440, slow: 720 },
  // Stops read in causal order, and the last one on the main line holds while the illness goes on.
  stopAfterMin: { airway: 0, immune: 60, brain: 180 },
  evidence: "B",
  source: "Karjalainen and Viitasalo 1986: 8.5 bpm per degree. Yki-Jarvinen et al. 1989: insulin action 52% lower. MedlinePlus: a cold lasts a week or two and rarely brings fever",
} as const;

export const SEX = {
  defaultMinutes: 25, // Frappier 2013: about 24 min on average
  defaultIntensity: 0.6,
  // Levine et al., AHA statement 2012: heart rate rarely above 130 bpm, systolic rarely above 170 mmHg.
  peakBpm: 130,
  peakSystolic: 170,
  // Bohlen 1984: effort is modest for most of it, with the maximum only in the brief span at the
  // end, then a quick return to near baseline. So a lower sustained level plus a short peak.
  sustainedShare: 0.45,
  briefPeakMin: 2,
  heart: { riseMin: 5, halfLifeMin: 3 },
  systolic: { riseMin: 5, halfLifeMin: 3 },
  breathing: { gain: 10, riseMin: 15, halfLifeMin: 3 }, // my estimate
  // Frappier 2013, at a typical effort: 4.2 kcal/min in men, 3.1 in women.
  kcalPerMin: { male: 4.2, female: 3.1 },
  metabolism: { riseMin: 2, halfLifeMin: 3 },
  // Kruger 1998: noradrenaline rises briefly, cortisol does not change.
  stress: { gain: 0.2, riseMin: 5, halfLifeMin: 5 },
  // Carmichael 1987 for oxytocin. The scale is my estimate.
  reward: { gain: 0.7, riseMin: 15, halfLifeMin: 60 },
  // Kruger 2002: prolactin stays raised for over an hour after orgasm. The drowsiness is my estimate.
  drowsiness: { gain: 0.35, riseMin: 5, halfLifeMin: 45 },
  relaxed: { gain: 0.5, riseMin: 5, halfLifeMin: 60 },
  evidence: "B",
  source: "Levine et al., AHA statement 2012 and Bohlen et al. 1984 for heart rate. Frappier et al. 2013 for energy. Kruger et al. 2002 for prolactin. Carmichael et al. 1987 for oxytocin",
} as const;

export const STRESS = {
  // Wiesli 2005, a standard stress test: heart rate 80 to 99 bpm, blood pressure 122 to 152 mmHg.
  heartAtFull: 19,
  systolicAtFull: 30,
  breathingAtFull: 4, // my estimate
  heart: { riseMin: 8, halfLifeMin: 12 },
  systolic: { riseMin: 8, halfLifeMin: 15 },
  // A long stretch of stress habituates: heart rate and pressure settle to about half. My estimate.
  settle: { toShare: 0.5, afterMin: 30, halfLifeMin: 15 },
  // Kirschbaum 1993: cortisol 2 to 4 times baseline. The scale and timing are my estimates.
  stress: { gain: 0.8, riseMin: 8, halfLifeMin: 45 },
  // Wiesli 2005: fasting glucose did not move, while it rose after a meal, so the liver term is small. My estimate.
  liverOutputAtFull: 0.15,
  metabolismAtFull: 0.1, // Seematter 2005: catecholamines raise energy use
  appetiteAtFull: -0.2, // my estimate
  tense: { gain: 0.7, riseMin: 8, halfLifeMin: 45 },
  stopAfterMin: { brain: 0, adrenals: 2, heart: 4, liver: 8, gut: 12 },
  evidence: "B",
  source: "Wiesli et al., Diabetes Care 2005: heart rate 80 to 99, pressure 122 to 152 in a stress test. Kirschbaum et al. 1993 for cortisol",
} as const;

export const POOR_SLEEP = {
  // Donga 2010, after 4 h of sleep: glucose infusion 25% lower, basal liver output unchanged.
  insulinSensitivityAtFull: -0.25,
  // Spiegel 2004: hunger up 24%, appetite up 23%.
  appetiteAtFull: 0.24,
  // Van Dongen 2003 shows the deficits. Scale set so a 4 h night reads about 17 of 100 at 15:00, between
  // the event told alone and the event plus the short sleep itself in the activity list. My estimate.
  drowsinessAtFull: 0.3,
  riseMin: 1,
  halfLifeMin: 240,
  tired: { gain: 0.55, riseMin: 1, halfLifeMin: 240 },
  evidence: "B",
  source: "Donga et al., JCEM 2010: 25% less insulin action after 4 h of sleep. Spiegel et al., Ann Intern Med 2004: hunger up 24%",
} as const;

// Walking and running act through the same channels as any event, so they ease off after stopping.
export const ACTIVITY = {
  // Share of heart rate reserve: ACSM counts 40 to 59% moderate and 60 to 89% vigorous, secondhand.
  heartReserve: { walking: 0.3, running: 0.7 },
  // Cole et al., NEJM 1999: heart rate normally falls over 12 bpm in the first minute after exercise.
  // A 4 min half-life from 150 bpm gives 13.
  heart: { riseMin: 2, halfLifeMin: 4 },
  breaths: { walking: 8, running: 21, riseMin: 2, halfLifeMin: 3 },
  // Barnes et al. 2019: 0.83 to 1.51 L/h in team and endurance sport, so 1.05 L/h for a recreational run.
  sweatMlPerMin: { walking: 3, running: 17.5, riseMin: 10, halfLifeMin: 10 },
  // Gleeson 1998 describes the rise, and it settles within about 20 min. The sizes are my estimates.
  temperatureC: { walking: 0.25, running: 1.35, riseMin: 20, halfLifeMin: 20 },
  // AHA exercise testing guidance: about 10 mmHg per MET, read secondhand.
  systolicMmHg: { walking: 17, running: 55, riseMin: 3, halfLifeMin: 4 },
  // Running loads the legs eccentrically, so they get sore. Flat running less than hard lifting.
  runSoreness: {
    fromMinutes: 10,
    intensity: 0.5,
    muscles: [
      { group: "quads", load: 1 },
      { group: "calves", load: 1 },
      { group: "hamstrings", load: 0.8 },
      { group: "glutes", load: 0.7 },
    ],
  },
} as const;

// A one-minute step overshoots and swings past these rates. My numerical limits; they only change a
// drug with a Tmax under about 5 minutes or a half-life under about 3 minutes.
export const SUBSTANCE_STEP = { maxAbsorptionPerMin: 0.5, maxClearancePerMin: 0.25 } as const;

// The lean mass formulas run past body weight on a very tall, very light body. My estimate of a floor for fat and everything else.
export const BODY_COMPOSITION = { maxLeanShare: 0.9 } as const;
