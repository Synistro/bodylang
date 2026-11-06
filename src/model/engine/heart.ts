import { BLOOD_FLOW, COUPLING, HEART } from "../params";
import type { CaffeineLevels } from "./gut";
import type { BodyConstants, Minute, Pools } from "./pools";

// What pushes the heart above rest. The loop adds these up, and the reading that explains the heart lists them.
export const heartFromDigestion = (digestion: number) => HEART.digestionGain * digestion;
export const heartFromCaffeine = (caffeineMgL: number) => HEART.caffeineGainPerMgL * caffeineMgL;

export interface Circulation {
  hr: number;
  cardiacOutput: number;
  flowMuscle: number;
  flowGut: number;
  flowKidneys: number;
  flowTotal: number;
}

export function stepHeart(
  pools: Pools,
  { posture, stress, i }: Minute,
  caffeine: CaffeineLevels,
  { anthro, channels, maxBpm }: BodyConstants,
): Circulation {
  const hr = Math.min(
    maxBpm,
    anthro.restingBpm +
      HEART.byActivity[posture] +
      heartFromDigestion(pools.digest) +
      heartFromCaffeine(caffeine.mgL) +
      channels.heartRate[i],
  );
  const exerting =
    posture === "walking" || posture === "running" || channels.muscleFlow[i] >= HEART.strokeWorkingFromMuscleFlow;
  const reserveUsed = exerting ? Math.max(0, channels.heartRate[i]) / (maxBpm - anthro.restingBpm) : 0;
  pools.strokeGain +=
    (Math.min(1, reserveUsed / HEART.strokePlateauReserveShare) - pools.strokeGain) / HEART.strokeEaseMin;
  const strokeMl = HEART.strokeVolumeMlPerKgLean * anthro.leanKg * (1 + HEART.strokeExerciseGain * pools.strokeGain);
  const flowMuscle = BLOOD_FLOW.rest.muscle + BLOOD_FLOW.activityMuscleGain[posture] + channels.muscleFlow[i];
  const movingCut = 1 - BLOOD_FLOW.activityGutKidneyCut[posture];
  const flowGut =
    (BLOOD_FLOW.rest.gut + BLOOD_FLOW.digestionGutGain * pools.digest) *
    (1 - COUPLING.stressCutsGutFlow * stress) *
    movingCut;
  const flowKidneys = BLOOD_FLOW.rest.kidneys * movingCut;
  return {
    hr,
    cardiacOutput: (hr * strokeMl) / 1000,
    flowMuscle,
    flowGut,
    flowKidneys,
    flowTotal:
      BLOOD_FLOW.rest.brain +
      BLOOD_FLOW.rest.heart +
      flowKidneys +
      flowGut +
      flowMuscle +
      BLOOD_FLOW.rest.skin +
      BLOOD_FLOW.rest.other,
  };
}
