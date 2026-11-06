import { ChannelId, runSessions } from "../events";
import { hormonesAt, cycleDay } from "../cycle";
import { BLOOD_FLOW, BODY_TEMPERATURE, CAFFEINE, HEART, RESTING_SYSTOLIC_MMHG } from "../params";
import { POSTURES, Posture, Scenario } from "../scenario";
import { Feelings, stepFeeling } from "./feel";
import { Contents, stepAlcoholAndFluids, stepContents } from "./fluids";
import { Energy, stepEnergy, stepFatAndProtein, stepGlucoseInsulin, SugarFlows } from "./glucose";
import { absorbGut, Absorbed, bloodKcalOf, CaffeineLevels, caffeineLevels, emptyStomach, Emptying, gutKcalOf, ingest, stepSubstances, stomachKcalOf } from "./gut";
import { Circulation, stepHeart } from "./heart";
import { BodyConstants, bodyConstants, Minute, Pools, resetAtMidnight, startingPools, startMinute } from "./pools";
import { FLOW_SIZE, LEDGER_SIZE, SERIES, SeriesName, Trajectory } from "./trajectory";

const POSTURE_INDEX = Object.fromEntries(POSTURES.map((posture, index) => [posture, index])) as Record<Posture, number>;

interface MinuteResult {
  minute: Minute;
  emptying: Emptying;
  absorbed: Absorbed;
  sugar: SugarFlows;
  caffeine: CaffeineLevels;
  contents: Contents;
  circulation: Circulation;
  energy: Energy;
  feelings: Feelings;
}

function recordSeries(series: Record<SeriesName, Float32Array>, pools: Pools, result: MinuteResult, { cycle, channels, muscleWork, alcoholVolumeL }: BodyConstants) {
  const { minute, emptying, absorbed, sugar, caffeine, contents, circulation, energy, feelings } = result;
  const { i, t, posture, stress } = minute;
  const hours = t / 60;
  series.glucose[i] = pools.glucose;
  series.insulin[i] = pools.insulin;
  series.insulinAction[i] = pools.insulinAction;
  series.tg[i] = pools.tg;
  series.caffeine[i] = caffeine.mgL;
  series.occupancy[i] = caffeine.occupancy;
  series.alcohol[i] = pools.alcoholBodyG / alcoholVolumeL;
  series.hr[i] = circulation.hr;
  series.breaths[i] = HEART.breathsByActivity[posture] + pools.digest * HEART.breathsPerDigestion + channels.breathing[i];
  series.cardiacOutput[i] = circulation.cardiacOutput;
  series.flowBrain[i] = BLOOD_FLOW.rest.brain / circulation.flowTotal;
  series.flowHeart[i] = BLOOD_FLOW.rest.heart / circulation.flowTotal;
  series.flowKidneys[i] = circulation.flowKidneys / circulation.flowTotal;
  series.flowGut[i] = circulation.flowGut / circulation.flowTotal;
  series.flowMuscle[i] = circulation.flowMuscle / circulation.flowTotal;
  series.stomachMl[i] = contents.stomachMl;
  series.stomachKcal[i] = contents.stomachKcal;
  series.gutKcal[i] = contents.gutKcal;
  series.emptyingKcalPerMin[i] = emptying.energyRate;
  series.glucoseAbsorbMgMin[i] = absorbed.glucoseSystemicMg;
  series.carbAbsorbMgMin[i] = absorbed.carbsG * 1000;
  series.fatAbsorbGMin[i] = absorbed.fatG;
  series.proteinAbsorbGMin[i] = absorbed.proteinG;
  series.insulinSecretion[i] = sugar.secretion;
  series.liverGlycogen[i] = pools.liverGlycogen;
  series.muscleGlycogen[i] = pools.muscleGlycogen;
  series.fatStoredG[i] = pools.fatStored;
  series.bladderMl[i] = pools.bladder;
  series.kcalPerHour[i] = energy.kcalPerHour;
  series.carbFuel[i] = energy.carbFuel;
  series.fullness[i] = feelings.fullness;
  series.alertness[i] = feelings.alertness;
  series.drowsy[i] = feelings.drowsy;
  series.jitter[i] = feelings.jitter;
  series.hunger[i] = feelings.hunger;
  series.crash[i] = feelings.crash;
  series.muscleUptakeGMin[i] = sugar.toMuscleG;
  series.insulinUptakeGMin[i] = sugar.insulinUptakeG;
  series.hepaticOutputGMin[i] = sugar.hepaticOutputG;
  series.liverUptakeGMin[i] = sugar.toLiverG + absorbed.liverDirectG;
  series.posture[i] = POSTURE_INDEX[posture];
  series.digestion[i] = pools.digest;
  series.mealDip[i] = feelings.mealDip;
  series.sleepPressure[i] = pools.sleepPressure;
  series.hoursAwake[i] = pools.hoursAwake;
  series.caffeineFelt[i] = caffeine.felt;
  series.temperature[i] = BODY_TEMPERATURE.meanC + BODY_TEMPERATURE.swingC * Math.cos((2 * Math.PI * (hours - BODY_TEMPERATURE.peakHour)) / 24) + channels.temperature[i];
  series.stressLevel[i] = stress;
  series.inflammation[i] = Math.min(1, channels.inflammation[i]);
  series.immune[i] = Math.min(1, channels.immune[i]);
  series.reward[i] = Math.min(1, channels.reward[i]);
  series.fluidBalance[i] = -pools.fluidDeficitMl;
  series.systolic[i] = RESTING_SYSTOLIC_MMHG + channels.bloodPressure[i] + CAFFEINE.bloodPressureGainMmHgPerMgL * caffeine.mgL;
  series.muscleWork[i] = muscleWork[i];
  if (cycle) {
    const hormones = hormonesAt(cycle, t);
    series.cycleDay[i] = cycleDay(cycle, t);
    series.estradiol[i] = hormones.estradiol;
    series.progesterone[i] = hormones.progesterone;
    series.lh[i] = hormones.lh;
  }
}

function recordLedgers({ tracks }: Pools, i: number) {
  for (const k of tracks) {
    const o = i * LEDGER_SIZE;
    k.ledger[o] = stomachKcalOf(k);
    k.ledger[o + 1] = gutKcalOf(k);
    k.ledger[o + 2] = bloodKcalOf(k);
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

export function simulate(scenario: Scenario): Trajectory {
  const constants = bodyConstants(scenario);
  const pools = startingPools(scenario, constants);
  const { leadIn, minutes, channels, events, anthro, activities, cycle } = constants;
  const series = Object.fromEntries(SERIES.map((name) => [name, new Float32Array(minutes)])) as Record<SeriesName, Float32Array>;

  for (let i = 0; i < minutes; i++) {
    const t = i - leadIn;
    if (t === 0 && leadIn > 0) resetAtMidnight(pools, constants);
    const minute = startMinute(pools, constants, i);
    ingest(pools, t);
    const emptying = emptyStomach(pools, minute);
    const absorbed = absorbGut(pools, emptying, constants);
    stepSubstances(pools, constants, i);
    stepAlcoholAndFluids(pools, absorbed, minute, constants);
    const sugar = stepGlucoseInsulin(pools, absorbed, minute, constants);
    stepFatAndProtein(pools, absorbed, sugar, constants);
    const caffeine = caffeineLevels(pools, constants);
    const contents = stepContents(pools, emptying, minute);
    const circulation = stepHeart(pools, minute, caffeine, constants);
    const energy = stepEnergy(pools, absorbed, sugar, minute, constants);
    const feelings = stepFeeling(pools, minute, caffeine, contents, constants);
    recordSeries(series, pools, { minute, emptying, absorbed, sugar, caffeine, contents, circulation, energy, feelings }, constants);
    recordLedgers(pools, i);
  }

  // Everything handed out starts at 00:00 today, so the lead-in is invisible to whoever reads it.
  return {
    scenario,
    anthro,
    series: Object.fromEntries(SERIES.map((name) => [name, series[name].subarray(leadIn)])) as Record<SeriesName, Float32Array>,
    intakeLedgers: new Map(pools.tracks.map((k) => [k.intake.id, { ledger: k.ledger.subarray(leadIn * LEDGER_SIZE), caffeineMg: k.intake.caffeineMg, caffeineLedger: k.caffeineLedger.subarray(leadIn * 4), flows: k.flows.subarray(leadIn * FLOW_SIZE), alcoholG: k.intake.alcoholG }])),
    substances: new Map(pools.substanceTracks.map((s) => [s.substance.id, { series: s.series.subarray(leadIn), ledger: s.ledger.subarray(leadIn * 3), substance: s.substance }])),
    events,
    channels: Object.fromEntries((Object.keys(channels) as ChannelId[]).map((id) => [id, channels[id].subarray(leadIn)])) as Record<ChannelId, Float32Array>,
    muscleEvents: [...(scenario.events ?? []), ...runSessions(activities)],
    cycle,
  };
}
