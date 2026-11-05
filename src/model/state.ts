import { CAFFEINE, DAY, PROCESS, STOMACH } from "./params";
import { availableCarbsG, caffeineLedgerAt, Intake, intakeFlowsAt, kcalOf, ledgerAt, Nutrients, OrganId, Trajectory, value } from "./simulate";

export type Tint = "chyme" | "glucose" | "fat" | "caffeine" | "insulin" | "alcohol" | "other" | null;

// What one organ is doing at one instant. Scene and labels both draw from this.
export interface OrganState {
  id: OrganId;
  title: string;
  activity: number;
  tint: Tint;
  reading: string; // the number
  doing: string; // the sentence
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number, by = 1) => Math.round(x / by) * by;

export const formatClock = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

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
    ...custom,
  ];

  return out;
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

export interface Whereabouts {
  id: string;
  label: string;
  at: number;
  unit: "kcal" | "mg";
  total: number;
  places: { key: string; label: string; amount: number; share: number; organ: OrganId | null }[];
}

const PLACE_LABEL: Record<string, { label: string; organ: OrganId | null }> = {
  stomach: { label: "Stomach", organ: "stomach" },
  intestine: { label: "Intestine", organ: "small_intestine" },
  blood: { label: "Blood", organ: "heart" },
  liver: { label: "Liver", organ: "liver" },
  muscle: { label: "Muscle", organ: "muscle" },
  fat: { label: "Fat", organ: "fat" },
  burned: { label: "Burned", organ: null },
  colon: { label: "Colon", organ: "large_intestine" },
  cleared: { label: "Cleared by liver", organ: "liver" },
};

// Whether something from yesterday is still on its way anywhere, or has long since arrived.
function stillMoving(tr: Trajectory, intake: Intake, t: number): boolean {
  const food = ledgerAt(tr, intake.id, t);
  const caffeine = caffeineLedgerAt(tr, intake.id, t);
  return (food ? food.stomach + food.intestine + food.blood : 0) > kcalOf(intake) * PROCESS.heldInStomachShare || (caffeine ? caffeine.stomach + caffeine.intestine + caffeine.blood : 0) > intake.caffeineMg * PROCESS.heldInStomachShare;
}

// "Where is my pizza right now?" — reads straight from the model's conserved ledgers.
export function whereabouts(tr: Trajectory, t: number): Whereabouts[] {
  const out: Whereabouts[] = [];
  for (const intake of tr.scenario.intakes) {
    if (intake.at > t) continue;
    if (intake.at < 0 && !stillMoving(tr, intake, t)) continue;
    const kcal = kcalOf(intake);
    const caffeine = caffeineLedgerAt(tr, intake.id, t);
    if (caffeine && kcal < 30) {
      const places = (["stomach", "intestine", "blood", "cleared"] as const).map((key) => ({ key, amount: caffeine[key] }));
      out.push(entry(intake.id, intake.label, intake.at, "mg", caffeine.dose, places));
      continue;
    }
    const l = ledgerAt(tr, intake.id, t);
    if (!l) continue;
    const places = (["stomach", "intestine", "blood", "liver", "muscle", "fat", "burned", "colon"] as const).map((key) => ({ key, amount: l[key] }));
    out.push(entry(intake.id, intake.label, intake.at, "kcal", kcal, places));
  }
  return out;
}

function entry(id: string, label: string, at: number, unit: "kcal" | "mg", total: number, places: { key: string; amount: number }[]): Whereabouts {
  return {
    id,
    label,
    at,
    unit,
    total,
    places: places
      .filter((p) => p.amount > total * 0.004)
      .map((p) => ({ ...p, label: PLACE_LABEL[p.key].label, organ: PLACE_LABEL[p.key].organ, share: p.amount / total }))
      .sort((a, b) => b.amount - a.amount),
  };
}

export interface Feelings {
  full: number;
  alert: number;
  sleepy: number;
  jittery: number;
  hungry: number;
  low: number;
}

export function feelingsAt(tr: Trajectory, t: number): Feelings {
  return {
    full: value(tr, "fullness", t),
    alert: value(tr, "alertness", t),
    sleepy: value(tr, "drowsy", t),
    jittery: value(tr, "jitter", t),
    hungry: value(tr, "hunger", t),
    low: value(tr, "crash", t),
  };
}

export interface Forecast {
  glucosePeak: { at: number; value: number } | null;
  glucoseSettles: number | null;
  sleepiest: { at: number; value: number } | null;
  stomachHalf: number | null;
  stomachEmpty: number | null;
  tgPeak: { at: number; value: number } | null;
  caffeineBelowFelt: number | null;
  caffeineAtBedMgL: number;
}

export function forecast(tr: Trajectory, now: number): Forecast {
  const n = tr.series.glucose.length;
  const start = Math.floor(now);
  const peak = (s: Float32Array, to: number) => {
    let best = start;
    for (let i = start; i < Math.min(to, n); i++) if (s[i] > s[best]) best = i;
    return best;
  };
  const firstBelow = (s: Float32Array, level: number) => {
    for (let i = start; i < n; i++) if (s[i] < level) return i;
    return null;
  };
  const base = tr.anthro.baselineGlucose;
  const gp = peak(tr.series.glucose, start + 300);
  const glucosePeak = tr.series.glucose[gp] > base + 4 ? { at: gp, value: tr.series.glucose[gp] } : null;
  let glucoseSettles: number | null = null;
  if (glucosePeak) for (let i = gp; i < n; i++) if (tr.series.glucose[i] < base + 8) { glucoseSettles = i; break; }
  const dp = peak(tr.series.drowsy, start + 300);
  const sleepiest = tr.series.drowsy[dp] > PROCESS.sleepyNamedFrom ? { at: dp, value: tr.series.drowsy[dp] } : null;
  const kcalNow = tr.series.stomachKcal[start];
  const tp = peak(tr.series.tg, n);
  return {
    glucosePeak,
    glucoseSettles,
    sleepiest,
    stomachHalf: kcalNow > 30 ? firstBelow(tr.series.stomachKcal, kcalNow / 2) : null,
    stomachEmpty: kcalNow > 30 ? firstBelow(tr.series.stomachKcal, 8) : null,
    tgPeak: tr.series.tg[tp] > tr.anthro.baselineTg + 15 ? { at: tp, value: tr.series.tg[tp] } : null,
    caffeineBelowFelt: tr.series.caffeine[start] > CAFFEINE.feltAboveMgL ? firstBelow(tr.series.caffeine, CAFFEINE.feltAboveMgL) : null,
    caffeineAtBedMgL: tr.series.caffeine[Math.min(n - 1, DAY.sleepMin)],
  };
}

// Energy the gut digests. Alcohol is absorbed unchanged, so it stays out of this count.
export const foodKcalOf = (n: Nutrients) => availableCarbsG(n) * 4 + n.proteinG * 4 + n.fatG * 9;

// A logged label as it reads inside a sentence: "Sugar bar" becomes "sugar bar", "IPA" stays.
export const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label);

export const joinAnd = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// Two names read well in a short reason; beyond that the food is simply the meal.
export const theFoods = (labels: string[]) => (labels.length > 2 || labels.length === 0 ? "the meal" : `the ${joinAnd(labels.map(inSentence))}`);

export const startCase = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// "9.5" and "10", never "10.0".
export const hoursText = (hours: number) => String(Number(hours.toFixed(1)));

// "1 hour", "9.5 hours".
export function hoursWord(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${hoursText(hours)} ${Number(hours.toFixed(1)) === 1 ? "hour" : "hours"}`;
}

// A scale from 0 to 1 reaches a person as a word.
export const levelWord = (x: number) => (x < 0.1 ? "Quiet" : x < 0.35 ? "Mild" : x < 0.65 ? "Moderate" : "Strong");

const partOfDay = (minute: number) => {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m < 5 * 60) return "night";
  if (m < 12 * 60) return "morning";
  if (m < 17 * 60) return "afternoon";
  return m < 21 * 60 ? "evening" : "night";
};

// A time said the way it is meant: a clock today, a part of the day tomorrow, days after that.
export function whenWords(at: number, t: number): string {
  const days = Math.floor(at / 1440) - Math.floor(t / 1440);
  if (days <= 0) return `near ${formatClock(at)}`;
  return days === 1 ? `tomorrow ${partOfDay(at)}` : `in ${days} days`;
}

// The intakes behind a rate right now, biggest first, leaving out the ones barely contributing.
function contributors(intakes: Intake[], rateOf: (intake: Intake) => number, floor: number): string[] {
  const rated = intakes.map((intake) => ({ intake, rate: rateOf(intake) })).filter((r) => r.rate > 0);
  const total = rated.reduce((sum, r) => sum + r.rate, 0);
  if (total < floor) return [];
  return rated
    .filter((r) => r.rate >= total * PROCESS.contributorShare)
    .sort((a, b) => b.rate - a.rate)
    .map((r) => r.intake.label);
}

export function arrivingFoods(tr: Trajectory, t: number, nutrient: "carbs" | "fat"): string[] {
  const rateOf = (intake: Intake) => {
    const flows = intakeFlowsAt(tr, intake.id, t);
    if (!flows) return 0;
    return nutrient === "carbs" ? flows.carbsAbsorbedPerMin : flows.fatAbsorbedPerMin;
  };
  return contributors(tr.scenario.intakes.filter((i) => i.at <= t), rateOf, PROCESS.arrivingAboveGPerMin);
}

export function foodsInStomach(tr: Trajectory, t: number): string[] {
  const rateOf = (intake: Intake) => {
    const held = ledgerAt(tr, intake.id, t)?.stomach ?? 0;
    return held > foodKcalOf(intake) * PROCESS.heldInStomachShare ? held : 0;
  };
  return contributors(tr.scenario.intakes.filter((i) => i.at <= t), rateOf, 1);
}
