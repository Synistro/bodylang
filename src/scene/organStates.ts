import { cycleDay, cyclePhase, liningShare } from "../model/cycle";
import { Trajectory, value } from "../model/engine/trajectory";
import type { OrganId, Tint } from "../model/ids";
import { DAY, STOMACH } from "../model/params";
import { clamp01 } from "../model/curve";

// What one organ is doing at one instant, which sets how brightly it flushes on the body.
export interface OrganState {
  id: OrganId;
  title: string;
  activity: number;
  tint: Tint;
  reading: string; // the number
  doing: string; // the sentence
}

const round = (x: number, by = 1) => Math.round(x / by) * by;

export function organStates(tr: Trajectory, t: number): OrganState[] {
  const v = (n: Parameters<typeof value>[1]) => value(tr, n, t);
  const baseG = tr.anthro.baselineGlucose;
  const stomachKcal = v("stomachKcal");
  const stomachMl = v("stomachMl");
  const insulinOver = v("insulin") - 8;
  const absorbG = v("glucoseAbsorbMgMin") / 1000;
  const absorbF = v("fatAbsorbGMin");
  const occ = v("occupancy");
  const felt = v("caffeineFelt");
  const caffeine = v("caffeine");
  const tgOver = v("tg") - tr.anthro.baselineTg;
  const alcohol = v("alcohol");
  const glucoseOver = Math.max(0, v("glucose") - baseG);
  const flowGut = v("flowGut");
  const custom = customStates(tr, t);

  const out: OrganState[] = [
    {
      id: "stomach",
      title: "Stomach",
      activity: clamp01((stomachMl - STOMACH.restingVolumeMl) / 420),
      tint: stomachKcal > 5 ? "chyme" : null,
      reading: `${round(stomachMl, 10)} ml`,
      doing: stomachKcal > 5 ? `Holding ${round(stomachKcal, 10)} kcal, letting out ${v("emptyingKcalPerMin").toFixed(1)} kcal a minute` : stomachMl > 90 ? "Passing liquid through" : "Empty and resting",
    },
    {
      id: "small_intestine",
      title: "Small intestine",
      activity: clamp01(absorbG / 0.55 + absorbF / 0.3 + v("gutKcal") / 300),
      tint: absorbG > 0.02 ? "glucose" : v("gutKcal") > 5 ? "chyme" : null,
      reading: absorbG > 0.02 ? `${(absorbG * 60).toFixed(0)} g/h` : "quiet",
      doing: absorbG > 0.02 ? `Absorbing sugar${absorbF > 0.02 ? " and fat" : ""} into the blood` : "Nothing arriving yet",
    },
    {
      id: "liver",
      title: "Liver",
      activity: clamp01(v("liverUptakeGMin") / 0.55 + caffeine / 2.2 + alcohol * 3),
      tint: alcohol > 0.03 ? "alcohol" : v("liverUptakeGMin") > 0.05 ? "glucose" : caffeine > 0.2 ? "caffeine" : null,
      reading: `${round(v("liverGlycogen"))} g glycogen`,
      doing: alcohol > 0.03 ? "Breaking down alcohol first, everything else waits" : v("liverUptakeGMin") > 0.05 ? "Storing sugar from the portal vein, and still clearing caffeine" : caffeine > 0.2 ? "Clearing caffeine, feeding the blood from glycogen" : "Feeding the blood from glycogen",
    },
    {
      id: "pancreas",
      title: "Pancreas",
      activity: clamp01(insulinOver / 26),
      tint: insulinOver > 2 ? "insulin" : null,
      reading: `${(v("insulin") / 8).toFixed(1)}× insulin`,
      doing: insulinOver > 2 ? "Releasing insulin, so cells take sugar in and stop burning fat" : "Keeping insulin at its resting level",
    },
    {
      id: "heart",
      title: "Heart",
      activity: clamp01((v("hr") - tr.anthro.restingBpm) / 30 + 0.14),
      tint: null,
      reading: `${round(v("hr"))} bpm`,
      doing: `${round(flowGut * 100)}% of blood going to the gut${flowGut > 0.27 ? ", up from 25%" : ""}`,
    },
    {
      id: "brain",
      title: "Brain",
      activity: clamp01(felt * 1.9),
      tint: felt > 0.1 ? "caffeine" : null,
      reading: occ > 0.01 ? `${round(occ * 100)}% blocked` : "clear",
      doing: felt > 0.1 ? `Caffeine sitting on adenosine receptors, ${round(caffeine * 10) / 10} mg/L in blood` : "Adenosine building as the day goes on",
    },
    {
      id: "muscle",
      title: "Muscles",
      activity: clamp01(v("muscleUptakeGMin") / 0.7),
      tint: v("muscleUptakeGMin") > 0.04 ? "glucose" : null,
      reading: `${(v("muscleUptakeGMin") * 60).toFixed(0)} g/h sugar`,
      doing: v("muscleUptakeGMin") > 0.04 ? postureUptakeText(v("posture")) : "Idle, taking almost nothing",
    },
    {
      id: "fat",
      title: "Fat tissue",
      activity: clamp01(tgOver / 110),
      tint: tgOver > 8 ? "fat" : null,
      reading: tgOver > 3 ? `+${round(tgOver)} mg/dL TG` : "resting",
      doing: tgOver > 8 ? "Pulling meal fat out of the blood and storing it" : "Releasing a little fat for fuel",
    },
    {
      id: "lungs",
      title: "Lungs",
      activity: clamp01((v("breaths") - 12) / 20),
      tint: null,
      reading: `${round(v("breaths"))} a minute`,
      doing: v("breaths") > 20 ? "Breathing harder to meet the demand" : "Breathing at a resting pace",
    },
    {
      id: "spleen",
      title: "Spleen",
      activity: clamp01(v("immune")),
      tint: null,
      reading: v("immune") > 0.05 ? `${round(v("immune") * 100)} of 100` : "quiet",
      doing: v("immune") > 0.05 ? "Filtering blood and rallying immune cells" : "Filtering old blood cells",
    },
    {
      id: "kidneys",
      title: "Kidneys",
      activity: clamp01(glucoseOver / 160 + caffeine * 0.05),
      tint: null,
      reading: `${round(v("bladderMl"), 10)} ml to bladder`,
      doing: "Filtering about a fifth of all blood",
    },
    ...reproductiveStates(tr, t),
    ...custom,
  ];

  return out;
}

// How busy the reproductive organs read on the body. With no cycle logged there is nothing to light.
function reproductiveStates(tr: Trajectory, t: number): OrganState[] {
  const { cycle } = tr;
  if (!cycle) return [];
  const phase = cyclePhase(cycle, t);
  const day = `Day ${cycleDay(cycle, t)}`;
  return [
    { id: "uterus", title: "Uterus", activity: phase === "period" ? 0.8 : 0.25 + 0.3 * liningShare(cycle, t), tint: null, reading: day, doing: phase === "period" ? "Shedding its lining" : "Keeping its lining" },
    { id: "ovaries", title: "Ovaries", activity: phase === "ovulation" ? 0.85 : phase === "luteal" ? 0.55 : 0.35, tint: null, reading: day, doing: phase === "ovulation" ? "Releasing an egg" : "Making hormones" },
  ];
}

function postureUptakeText(posture: number) {
  return posture >= 3 ? "Working, pulling sugar out of the blood without needing much insulin" : "Insulin is opening them to sugar, slowly while you sit";
}

function customStates(tr: Trajectory, t: number): OrganState[] {
  const out: OrganState[] = [];
  for (const { substance, series } of tr.substances.values()) {
    const minute = Math.max(0, Math.min(DAY.minutes, Math.floor(t)));
    const c = series[minute];
    if (c < 0.001) continue;
    const peak = series.reduce((a, b) => Math.max(a, b), 0);
    for (const target of substance.targets) {
      out.push({
        id: target.organ,
        title: `${substance.label} · ${target.organ.replace("_", " ")}`,
        activity: clamp01((c / peak) * 0.95),
        tint: "other",
        reading: `${c.toFixed(1)} mg/L`,
        doing: target.effect,
      });
    }
  }
  return out;
}
