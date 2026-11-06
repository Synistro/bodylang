import { DAY } from "./params";
import { ActivitySpan, Intake, Posture, postureAt } from "./scenario";

export function withActivity(
  activities: ActivitySpan[],
  posture: Posture,
  from: number,
  until?: number,
): ActivitySpan[] {
  // What the body would be doing by then anyway, which past bedtime is sleeping.
  const resume = until === undefined ? null : postureAt(activities, until);
  const kept = activities.filter((a) => a.from < from || (until !== undefined && a.from >= until));
  const next: ActivitySpan[] = [...kept, { from, posture }];
  // The body falls asleep at bedtime unless a span starts after it, so a late walk has to say it's still going.
  if (until !== undefined && from < DAY.sleepMin && until > DAY.sleepMin) next.push({ from: DAY.sleepMin, posture });
  if (until !== undefined && resume) next.push({ from: until, posture: resume });
  return next.sort((a, b) => a.from - b.from);
}

// The night they describe. Past their usual bedtime they were still up, and once awake they stay up.
export function withSleep(activities: ActivitySpan[], bed: number, wake: number): ActivitySpan[] {
  const usualBed = DAY.sleepMin - 1440;
  const afterwards = postureAt(activities, wake);
  const kept = activities.filter((a) => a.from < Math.min(bed, usualBed) || a.from > wake);
  const up: ActivitySpan[] = bed > usualBed ? [{ from: usualBed, posture: "sitting" }] : [];
  const next: ActivitySpan[] = [
    ...kept,
    ...up,
    { from: bed, posture: "sleeping" },
    { from: wake, posture: afterwards === "sleeping" ? "standing" : afterwards },
  ];
  return next.sort((a, b) => a.from - b.from);
}

export const scaledTo = (intake: Intake, grams: number): Intake => {
  const by = grams / intake.grams;
  const source =
    intake.source?.kind === "recipe"
      ? {
          ...intake.source,
          ingredients: intake.source.ingredients.map((part) => ({ ...part, grams: part.grams * by })),
        }
      : intake.source;
  return {
    ...intake,
    source,
    grams,
    waterMl: intake.waterMl * by,
    carbsG: intake.carbsG * by,
    sugarG: intake.sugarG * by,
    fatG: intake.fatG * by,
    proteinG: intake.proteinG * by,
    fiberG: intake.fiberG * by,
    caffeineMg: intake.caffeineMg * by,
    alcoholG: intake.alcoholG * by,
  };
};
