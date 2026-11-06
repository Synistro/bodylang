import { Cycle, lutealShare } from "../cycle";
import { activityBouts, resolveEvent } from "../events/presets";
import { ChannelId, ResolvedEvent } from "../events/types";
import { channelSeries } from "../events/curves";
import { muscleWorkSeries, maxHeartRate } from "../events/muscles";
import {
  ALCOHOL,
  CAFFEINE,
  CYCLE,
  DAY,
  FASTING,
  FEEL,
  GLUCOSE,
  INSULIN,
  KIDNEY,
  LIPID,
  LIVER,
  MUSCLE,
  STOMACH,
} from "../params";
import { ActivitySpan, Body, Posture, postureAt, Scenario } from "../scenario";
import { alcoholVolumeL, Anthropometrics, anthropometrics } from "./anthropometrics";
import { heldInGutKcal, newIntakeTrack, newSubstanceTrack, IntakeTrack, SubstanceTrack } from "./tracks";

// What stays the same for one body across one run.
export interface BodyConstants {
  body: Body;
  anthro: Anthropometrics;
  leadIn: number; // minutes run before 00:00 today, so what is left of yesterday is still there
  minutes: number; // the whole run, lead-in included
  activities: ActivitySpan[];
  events: ResolvedEvent[];
  channels: Record<ChannelId, Float32Array>;
  muscleWork: Float32Array;
  cycle: Cycle | null;
  maxBpm: number;
  caffeineClearancePerMin: number;
  insulinCompensation: number; // a resistant body makes more insulin
  glucoseSpaceDl: number;
  tgSpaceDl: number;
  hepaticBaseGPerMin: number;
  caffeineVolumeL: number;
  alcoholVolumeL: number;
  alcoholEliminationGPerMin: number;
}

// What changes minute by minute, carried from one to the next.
export interface Pools {
  tracks: IntakeTrack[];
  substanceTracks: SubstanceTrack[];
  glucose: number;
  previousGlucose: number;
  insulin: number;
  insulinAction: number;
  tg: number;
  alcoholBodyG: number;
  liverGlycogen: number;
  muscleGlycogen: number;
  fatStored: number;
  bladder: number;
  bodyWater: number;
  fluidDeficitMl: number;
  digest: number;
  afterglow: number;
  strokeGain: number;
  lastMealEnd: number;
  lastFed: number;
  hoursAwake: number;
  sleepPressure: number;
  wokeAt: number;
}

// What one minute starts from.
export interface Minute {
  i: number; // index into the run
  t: number; // minutes since 00:00 today
  posture: Posture;
  asleep: boolean;
  stress: number;
  muscleWork: number;
}

// A cycle only applies to a body with the anatomy for one.
const cycleOf = (s: Pick<Scenario, "body" | "cycle">): Cycle | null =>
  s.body.sex === "female" ? (s.cycle ?? null) : null;

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

// How long before 00:00 today the run has to start, in whole days so the clock it starts on stays 00:00.
function leadInMinutes({ intakes, substances, activities }: Scenario): number {
  const earliest = Math.min(
    0,
    ...intakes.map((i) => i.at),
    ...substances.map((s) => s.at),
    ...activities.map((a) => a.from),
  );
  return Math.min(DAY.carryDaysMost, Math.ceil(-earliest / 1440)) * 1440;
}

export function bodyConstants(scenario: Scenario): BodyConstants {
  const { body } = scenario;
  const anthro = anthropometrics(body);
  const leadIn = leadInMinutes(scenario);
  const minutes = leadIn + DAY.minutes + 1;
  const activities = [...scenario.activities].sort((a, b) => a.from - b.from);
  // Sorted so the same events give the same bits, whatever order they were told in.
  const events = [...(scenario.events ?? [])]
    .sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1))
    .map((event) => resolveEvent(event, { body, anthro }));
  const channels = channelSeries(events, minutes, activityBouts(activities, { body, anthro }), -leadIn);
  const cycle = cycleOf(scenario);
  if (cycle) addCycleChannels(channels, cycle, -leadIn);
  const fatKg = Math.max(0, body.weightKg - anthro.leanKg);
  const alcoholVolume = alcoholVolumeL(body);
  return {
    body,
    anthro,
    leadIn,
    minutes,
    activities,
    events,
    channels,
    muscleWork: muscleWorkSeries(events, minutes, -leadIn),
    cycle,
    maxBpm: maxHeartRate(body.age),
    caffeineClearancePerMin: Math.LN2 / (anthro.caffeineHalfLifeH * 60),
    insulinCompensation: (INSULIN.sensitivity / anthro.sensitivity) ** INSULIN.resistanceCompensationPower,
    glucoseSpaceDl: GLUCOSE.distributionDlPerKgLean * (anthro.leanKg + GLUCOSE.distributionFatShare * fatKg),
    tgSpaceDl: LIPID.plasmaDlPerKg * body.weightKg,
    hepaticBaseGPerMin: GLUCOSE.hepaticOutputGPerMinPerKg * body.weightKg,
    caffeineVolumeL: CAFFEINE.volumeLPerKg * body.weightKg,
    alcoholVolumeL: alcoholVolume,
    alcoholEliminationGPerMin: (ALCOHOL.eliminationGPerLPerH * alcoholVolume) / 60,
  };
}

export function startingPools(scenario: Scenario, constants: BodyConstants): Pools {
  const { anthro, activities, leadIn, minutes } = constants;
  // The day before counts: last night's bedtime and how long ago you woke carry into sleep pressure.
  const wakingHoursYesterday = (DAY.sleepMin - DAY.wakeMin) / 60;
  const startsAwake = postureAt(activities, -leadIn) !== "sleeping";
  const hoursAwake = startsAwake ? wakingHoursYesterday + (1440 - DAY.sleepMin) / 60 : 0;
  return {
    tracks: scenario.intakes
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((intake) => newIntakeTrack(intake, minutes)),
    substanceTracks: scenario.substances.map((substance) => newSubstanceTrack(substance, minutes)),
    // Slow pools settle across a simulated night before the visible day starts.
    glucose: anthro.baselineGlucose,
    previousGlucose: anthro.baselineGlucose,
    insulin: INSULIN.baselineUUPerMl,
    insulinAction: 0,
    tg: anthro.baselineTg,
    alcoholBodyG: 0,
    liverGlycogen: LIVER.glycogenStartG,
    muscleGlycogen: anthro.muscleGlycogenMaxG * MUSCLE.glycogenStartShare,
    fatStored: 0,
    bladder: KIDNEY.bladderStartMl,
    bodyWater: 0,
    fluidDeficitMl: 0,
    digest: 0,
    afterglow: 0,
    strokeGain: 0,
    lastMealEnd: -Infinity,
    lastFed: FASTING.assumedLastMealMin - leadIn,
    hoursAwake,
    sleepPressure: startsAwake
      ? hoursAwake * FEEL.sleepPressurePerHour
      : wakingHoursYesterday *
        FEEL.sleepPressurePerHour *
        Math.exp(-((1440 - DAY.sleepMin) / 60) / FEEL.sleepPressureDecayTauH),
    wokeAt: startsAwake ? -leadIn : -Infinity,
  };
}

// A day nobody logged in full would otherwise read as a day of fasting. Only what the log can really say
// carries over: what is still in the gut and blood, and how you slept.
export function resetAtMidnight(pools: Pools, { anthro, activities }: BodyConstants) {
  pools.liverGlycogen = LIVER.glycogenStartG;
  pools.muscleGlycogen = anthro.muscleGlycogenMaxG * MUSCLE.glycogenStartShare;
  pools.fatStored = 0;
  pools.fluidDeficitMl = 0;
  pools.bladder = KIDNEY.bladderStartMl;
  pools.lastFed = Math.max(pools.lastFed, FASTING.assumedLastMealMin);
  if (heldInGutKcal(pools.tracks) <= STOMACH.fedAboveKcal) pools.lastMealEnd = -Infinity;
  if (postureAt(activities, 0) === "sleeping") pools.wokeAt = -Infinity;
}

export function startMinute(
  pools: Pools,
  { activities, channels, muscleWork, leadIn }: BodyConstants,
  i: number,
): Minute {
  const t = i - leadIn;
  const posture = postureAt(activities, t);
  const asleep = posture === "sleeping";
  if (!asleep && !Number.isFinite(pools.wokeAt)) pools.wokeAt = t;
  pools.hoursAwake = asleep ? 0 : pools.hoursAwake + 1 / 60;
  return { i, t, posture, asleep, stress: Math.min(1, channels.stress[i]), muscleWork: muscleWork[i] };
}
