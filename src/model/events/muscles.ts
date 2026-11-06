import { MUSCLE_LABEL, MuscleGroup } from "../muscleGroups";
import { DAY, MUSCLE_RECOVERY, SEX, TRAINING } from "../params";
import { clamp01 } from "../curve";
import { decay } from "./curves";
import { BodyEvent, MuscleState, MuscleWork } from "./types";

export const hours = (x: number) => x * 60;

// One group's state from one session, in closed form so it reads days past the simulated window.
export function muscleStateFromEvent(event: BodyEvent, end: number, load: number, t: number): MuscleState {
  const m = MUSCLE_RECOVERY;
  const strain = load * event.intensity;
  if (t < event.from || strain <= 0) return { work: 0, fatigue: 0, soreness: 0, repair: 0, glycogenUsed: 0 };
  const session = Math.max(1, end - event.from);
  const during = Math.min(1, (Math.min(t, end) - event.from) / session);
  if (t <= end) {
    return { work: clamp01(strain), fatigue: clamp01(strain * during), soreness: 0, repair: 0, glycogenUsed: clamp01(m.glycogenUsedAtFull * strain * during) };
  }
  const since = t - end;
  const sinceH = since / 60;
  const phase = sinceH / m.sorenessPeakH;
  return {
    work: clamp01(strain * decay(since, m.workFallHalfLifeMin)),
    fatigue: clamp01(strain * decay(since, hours(m.fatigueHalfLifeH))),
    soreness: clamp01(strain * phase ** m.sorenessShape * Math.exp(m.sorenessShape * (1 - phase))),
    repair: clamp01(strain * Math.min(1, since / m.repairRiseMin) * decay(Math.max(0, since - m.repairRiseMin), hours(m.repairHalfLifeH))),
    glycogenUsed: clamp01(m.glycogenUsedAtFull * strain * decay(since, m.glycogenRefillHalfLifeMin)),
  };
}

export function endOf(event: BodyEvent): number | null {
  if (event.until !== null) return event.until;
  switch (event.preset) {
    case "training":
      return event.from + TRAINING.defaultMinutes;
    case "sex":
      return event.from + SEX.defaultMinutes;
    case "poor_sleep":
      return Math.max(event.from + 1, DAY.sleepMin);
    case "illness":
    case "stress":
    case "custom":
      return null;
    default: {
      const exhaustive: never = event.preset;
      return exhaustive;
    }
  }
}

// A muscle's state across every event, added up: reads any minute, today or days from now.
export function muscleStateAt(events: BodyEvent[], group: MuscleGroup, minute: number): MuscleState {
  const total: MuscleState = { work: 0, fatigue: 0, soreness: 0, repair: 0, glycogenUsed: 0 };
  for (const event of events) {
    const work = event.muscles.find((m) => m.group === group);
    const end = endOf(event);
    if (!work || end === null) continue;
    const one = muscleStateFromEvent(event, end, work.load, minute);
    total.work += one.work;
    total.fatigue += one.fatigue;
    total.soreness += one.soreness;
    total.repair += one.repair;
    total.glycogenUsed += one.glycogenUsed;
  }
  return { work: clamp01(total.work), fatigue: clamp01(total.fatigue), soreness: clamp01(total.soreness), repair: clamp01(total.repair), glycogenUsed: clamp01(total.glycogenUsed) };
}

// A muscle's state told as what happens to its fibres: how hard they work, how much is torn and not yet
// repaired, how sore it feels, and how much has been rebuilt. Damage builds through a session, and repair
// work then stands for what is still torn. What repair has finished is what has been rebuilt.
export function muscleStoryAt(events: BodyEvent[], group: MuscleGroup, minute: number) {
  const { work, fatigue, soreness, repair } = muscleStateAt(events, group, minute);
  let strained = 0;
  let during = false;
  for (const event of events) {
    const worked = event.muscles.find((m) => m.group === group);
    const end = endOf(event);
    if (!worked || end === null || minute < event.from) continue;
    if (minute <= end) during = true;
    else strained += worked.load * event.intensity;
  }
  return {
    load: during ? work : 0,
    damage: clamp01(during ? fatigue : repair),
    soreness,
    healed: clamp01(Math.max(0, strained - repair)),
  };
}

export const maxHeartRate = (age: number) => TRAINING.maxHeartRate.intercept - TRAINING.maxHeartRate.perYearOfAge * age;

export const namesOf = (muscles: MuscleWork[]) => {
  const names = [...muscles].sort((a, b) => b.load - a.load).map((m) => MUSCLE_LABEL[m.group].toLowerCase());
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} and more` : names.join(" and ");
};
