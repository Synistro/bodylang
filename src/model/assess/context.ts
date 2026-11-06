import { lutealShare } from "../cycle";
import { ChannelId, ResolvedEvent, MuscleState, MuscleWork, BodyEvent } from "../events/types";
import { effectAt } from "../events/curves";
import { endOf, muscleStateAt } from "../events/muscles";
import { CAFFEINE, CYCLE, DAY, Evidence, HEART, KIDNEY, PROCESS, REFERENCE, STOMACH, MUSCLE_RECOVERY } from "../params";
import { heartFromCaffeine, heartFromDigestion } from "../engine/heart";
import { caffeineLedgerAt, SeriesName, Trajectory, value } from "../engine/trajectory";
import { foodKcalOf, Intake, Posture, POSTURES } from "../scenario";
import { OrganId } from "../ids";
import { arrivingFoods } from "../whereabouts";
import { formatClock, hoursWord, joinAnd, whenWords } from "../words";
import { Judgement, MealPhase, ReadingScale, Trend } from "./types";
import { MUSCLE_GROUPS } from "../muscleGroups";

// What every table row can look at: the moment, and what is acting on the body.
export interface Context {
  tr: Trajectory;
  t: number;
  v: (name: SeriesName, at?: number) => number;
  posture: Posture;
  asleep: boolean;
  moving: boolean;
  events: ResolvedEvent[]; // what has started by now
  exerting: boolean; // training or sex is driving the heart right now, recovery included
  training: ResolvedEvent | null; // a session under way this minute
  phase: MealPhase;
  eaten: Intake[];
  lastFood: Intake | null;
  carbsPeaking: boolean; // within the window where a peak above the 2 h cutoff is ordinary
  afterCarbs: boolean; // within the window where a dip below your starting level is ordinary
  carbsActive: boolean;
  afterFattyMeal: boolean;
}

// One reading at this moment, in the series' own units and on the reading's scale.
export interface Sample {
  raw: number;
  value: number;
  trend: Trend;
}

// A reason table reads top to bottom and the first passing row wins, so order is priority. New
// causes join a table as new rows; the last row of each table always passes.
export type ReasonRow = readonly [test: (c: Context, s: Sample) => boolean, text: (c: Context, s: Sample) => string];
export const always = () => true;

// A forecast table works the same way: the first rule with something to say wins.
export type ForecastRule = (c: Context, s: Sample, series: SeriesName) => Said | null;
export interface Said {
  text: string;
  short: string; // the same thing where room is tight: "Peaks at 6.9 17:53"
  at: number | null;
}
export const near = (text: string, at: number): Said => ({
  text: `${text} near ${clock(at)}`,
  short: `${text} ${clock(at)}`,
  at,
});

interface ReadingRange extends ReadingScale {
  evidence: Evidence;
  source: string;
}

export interface ReadingSpec {
  label: string;
  organ: OrganId;
  series: SeriesName;
  unit: string;
  toValue: (raw: number, c: Context) => number;
  format: (value: number) => string;
  trendEpsilon: number; // in the series' units, over the trend window
  headingChange: number | null; // the smallest move worth drawing, in the series' units
  range: (c: Context) => ReadingRange;
  judge: (c: Context, s: Sample) => Judgement;
  why: readonly ReasonRow[];
  forecast: readonly ForecastRule[];
}

export const clock = formatClock;
export const toMmol = (mgDl: number) => mgDl / REFERENCE.mgDlPerMmolGlucose;
export const identity = (x: number) => x;
export const fixed = (digits: number) => (x: number) => x.toFixed(digits);
export const rounded = (x: number) => String(Math.round(x));
export const tens = (x: number) => String(Math.round(x / 10) * 10);
export const perHour = (gPerMin: number) => gPerMin * 60;
export const percentOf = (x: number) => x * 100;
export const gramsPerHourFromMg = (mgPerMin: number) => (mgPerMin / 1000) * 60;

export function contextAt(tr: Trajectory, t: number): Context {
  const v = (name: SeriesName, at = t) => value(tr, name, at);
  const posture = POSTURES[Math.round(v("posture"))];
  const eaten = tr.scenario.intakes.filter((i) => i.at <= t).sort((a, b) => a.at - b.at);
  const foods = eaten.filter((i) => foodKcalOf(i) >= REFERENCE.stillDigestingKcal);
  const lastFood = foods.length ? foods[foods.length - 1] : null;
  const sinceFood = lastFood ? t - lastFood.at : Infinity;
  const carbs = eaten.filter((i) => i.carbsG > 0);
  const sinceCarbs = carbs.length ? t - carbs[carbs.length - 1].at : Infinity;
  const digesting = v("stomachKcal") > REFERENCE.stillDigestingKcal || v("gutKcal") > REFERENCE.stillDigestingKcal;
  const fattyMeals = eaten.filter((i) => i.fatG >= REFERENCE.triglycerides.fatMealG);
  const sinceFat = fattyMeals.length ? t - fattyMeals[fattyMeals.length - 1].at : Infinity;
  const events = tr.events.filter((e) => e.from <= t);
  const drivingHeart = (e: ResolvedEvent) => effectAt(e, "heartRate", t) >= REFERENCE.eventHeartDrivenFromBpm;
  return {
    tr,
    t,
    v,
    posture,
    asleep: posture === "sleeping",
    moving: posture === "walking" || posture === "running",
    events,
    exerting: events.some((e) => (e.preset === "training" || e.preset === "sex") && drivingHeart(e)),
    training: events.find((e) => e.preset === "training" && e.ends !== null && t <= e.ends) ?? null,
    phase:
      digesting || sinceFood <= REFERENCE.fedAfterFoodMin
        ? "fed"
        : sinceFood < REFERENCE.fastingAfterMin
          ? "settling"
          : "fasting",
    eaten,
    lastFood,
    carbsPeaking: sinceCarbs <= REFERENCE.glucose.peakWindowMin,
    afterCarbs: sinceCarbs <= REFERENCE.glucose.dip.windowMin,
    carbsActive:
      sinceCarbs <= REFERENCE.glucose.mealWindowMin ||
      v("glucoseAbsorbMgMin") > REFERENCE.glucose.stillAbsorbingMgPerMin,
    afterFattyMeal: sinceFat <= REFERENCE.triglycerides.fatWindowMin,
  };
}

const firstMinute = (c: Context) => Math.max(0, Math.min(DAY.minutes, Math.ceil(c.t)));

export function extremeAhead(
  c: Context,
  name: SeriesName,
  kind: "max" | "min",
  horizon: number = REFERENCE.headingHorizonMin,
) {
  const series = c.tr.series[name];
  const direction = kind === "max" ? 1 : -1;
  const end = Math.min(DAY.minutes, firstMinute(c) + horizon);
  let at = firstMinute(c);
  for (let m = at; m <= end; m++) if (direction * (series[m] - series[at]) > 0) at = m;
  // A window can close mid-climb. Follow the curve until it turns so a reported peak is a real one.
  let turn = end;
  while (turn < DAY.minutes && direction * (series[turn + 1] - series[turn]) > 0) turn++;
  if (direction * (series[turn] - series[at]) > 0) at = turn;
  return { at, value: series[at] };
}

// A peak counts only when it is clearly above now and still some minutes away.
export function peakAhead(c: Context, name: SeriesName, minRise: number, horizon?: number) {
  const peak = extremeAhead(c, name, "max", horizon);
  return peak.at > c.t + 2 && peak.value - c.v(name) >= minRise ? peak : null;
}

export function firstWhen(c: Context, test: (minute: number) => boolean): number | null {
  for (let m = firstMinute(c); m <= DAY.minutes; m++) if (test(m)) return m;
  return null;
}

export function headingOf(c: Context, spec: ReadingSpec): number | null {
  if (spec.headingChange === null) return null;
  const now = c.v(spec.series);
  const high = extremeAhead(c, spec.series, "max").value;
  const low = extremeAhead(c, spec.series, "min").value;
  const farther = high - now >= now - low ? high : low;
  return Math.abs(farther - now) < spec.headingChange ? null : spec.toValue(farther, c);
}

export function trendOf(c: Context, spec: ReadingSpec): Trend {
  const change = c.v(spec.series, c.t + REFERENCE.trendWindowMin) - c.v(spec.series, c.t - REFERENCE.trendWindowMin);
  if (change > spec.trendEpsilon) return "rising";
  return change < -spec.trendEpsilon ? "falling" : "steady";
}

export const peaksAt =
  (minRise: number, text: (raw: number) => string, horizon?: number, above?: (c: Context) => number): ForecastRule =>
  (c, _s, series) => {
    const peak = peakAhead(c, series, minRise, horizon);
    if (!peak || (above && peak.value <= above(c))) return null;
    return near(text(peak.value), peak.at);
  };

// The first minute the curve passes a test, once the guard says it is worth saying.
export const reaches =
  (
    guard: (c: Context, s: Sample) => boolean,
    test: (raw: number, c: Context) => boolean,
    text: (raw: number) => string,
  ): ForecastRule =>
  (c, s, series) => {
    if (!guard(c, s)) return null;
    const at = firstWhen(c, (m) => test(c.tr.series[series][m], c));
    return at === null ? null : near(text(c.tr.series[series][at]), at);
  };

export const foodsNowArriving = (c: Context, nutrient: "carbs" | "fat") => arrivingFoods(c.tr, c.t, nutrient);

export function caffeineLeft(c: Context) {
  let dose = 0;
  let left = 0;
  for (const intake of c.eaten) {
    const ledger = caffeineLedgerAt(c.tr, intake.id, c.t);
    if (ledger) {
      dose += ledger.dose;
      left += ledger.stomach + ledger.intestine + ledger.blood;
    }
  }
  return { dose, left };
}

export const caffeinePresent = (c: Context) =>
  c.v("caffeine") >= REFERENCE.caffeine.presentAboveMgL || caffeineLeft(c).left >= 1;
export const costsSleep = (c: Context) =>
  caffeinePresent(c) && c.t < DAY.sleepMin && c.v("caffeine", DAY.sleepMin) >= CAFFEINE.sleepConcernMgL;
export const caffeineDoseMgL = (c: Context, doseMg: number) =>
  doseMg / (CAFFEINE.volumeLPerKg * c.tr.scenario.body.weightKg);
export const nearestMinute = (c: Context) => Math.max(0, Math.min(DAY.minutes, Math.round(c.t)));
export const ownRestBpm = (c: Context, posture: Posture = c.posture) =>
  c.tr.anthro.restingBpm + HEART.byActivity[posture];
export const digesting = (c: Context) => c.v("digestion") > REFERENCE.digestion.underWayAbove;

export const hoursAwake = (c: Context) => c.v("hoursAwake");

export const POSTURE_WORD: Record<Posture, string> = {
  sleeping: "Sleep",
  sitting: "Sitting",
  standing: "Standing",
  walking: "Walking",
  running: "Running",
};

// The event pushing a channel the most right now, for a reason to name.
export function topCause(c: Context, channel: ChannelId, atLeast: number): ResolvedEvent | null {
  let best: ResolvedEvent | null = null;
  let size = atLeast;
  for (const event of c.events) {
    const amount = Math.abs(effectAt(event, channel, c.t));
    if (amount >= size) {
      best = event;
      size = amount;
    }
  }
  return best;
}

export const causeOf = (c: Context, channel: ChannelId, atLeast: number) =>
  topCause(c, channel, atLeast)?.causeName ?? null;
export const startedBy = (channel: ChannelId, atLeast: number) => (c: Context) =>
  topCause(c, channel, atLeast) !== null;

// A reason row naming whichever event is pushing this channel.
export const causedBy = (
  channel: ChannelId,
  atLeast: number,
  text: (cause: string, amount: number) => string,
): ReasonRow => [
  startedBy(channel, atLeast),
  (c) => {
    const event = topCause(c, channel, atLeast);
    return event ? text(event.causeName, effectAt(event, channel, c.t)) : "";
  },
];

export const raises = (cause: string) => `Raised by ${cause}`;

// What the luteal phase is adding to a channel. Only heart rate and temperature ever get named.
export function fromCycle(c: Context, channel: ChannelId, at = c.t): number {
  if (!c.tr.cycle) return 0;
  const size =
    channel === "heartRate" ? CYCLE.luteal.heartBpm : channel === "temperature" ? CYCLE.luteal.temperatureC : 0;
  return size * lutealShare(c.tr.cycle, at);
}

// What a walk or run is adding to a channel, including what lingers after you stop.
export function fromMoving(c: Context, channel: ChannelId, at = c.t): number {
  const fromEvents = c.events.reduce((sum, e) => sum + effectAt(e, channel, at), 0);
  return Math.max(
    0,
    c.tr.channels[channel][Math.max(0, Math.min(DAY.minutes - 1, Math.round(at)))] -
      fromEvents -
      fromCycle(c, channel, at),
  );
}

// "running" or "walking": whichever you did last, for naming what still lingers.
export function movedWord(c: Context): string {
  const moved = [...c.tr.scenario.activities]
    .sort((a, b) => a.from - b.from)
    .filter((span) => span.from <= c.t && (span.posture === "walking" || span.posture === "running"));
  const last = moved[moved.length - 1];
  return last ? POSTURE_WORD[last.posture].toLowerCase() : "moving";
}

// What is pushing the heart above its plain resting rate, biggest first. Events are rows of their own.
export function heartCauses(c: Context): { name: string; bpm: number }[] {
  const fixedRows = [
    { name: movedWord(c), bpm: fromMoving(c, "heartRate") },
    { name: "digestion", bpm: heartFromDigestion(c.v("digestion")) },
    { name: "caffeine", bpm: heartFromCaffeine(c.v("caffeine")) },
    { name: "your cycle", bpm: fromCycle(c, "heartRate") },
  ];
  const named = (e: ResolvedEvent) =>
    e.preset === "illness" && effectAt(e, "temperature", c.t) >= PROCESS.feverNamedFromC ? "the fever" : e.causeName;
  const rows = c.events.map((e) => ({ name: named(e), bpm: effectAt(e, "heartRate", c.t) }));
  return [...fixedRows, ...rows].filter((row) => row.bpm >= 1).sort((a, b) => b.bpm - a.bpm);
}

export function heartReason(c: Context): string | null {
  const [first, second] = heartCauses(c);
  if (!first) return null;
  const one = `About ${Math.round(first.bpm)} bpm from ${first.name}`;
  if (!second) return one;
  const both = `${one}, ${Math.round(second.bpm)} from ${second.name}`;
  return both.split(/\s+/).length <= PROCESS.reasonWordsMost ? both : one;
}

export function eventHeartBpm(c: Context) {
  return c.events.reduce((sum, e) => sum + effectAt(e, "heartRate", c.t), 0);
}

// What is pulling alertness down. Ordered as it reads in a sentence.
const ALERTNESS_DRAINS: { active: (c: Context) => boolean; words: (c: Context) => string }[] = [
  {
    active: startedBy("drowsiness", PROCESS.eventDrowsinessNamedFrom),
    words: (c) => causeOf(c, "drowsiness", PROCESS.eventDrowsinessNamedFrom) ?? "",
  },
  { active: (c) => c.v("mealDip") >= PROCESS.mealPullsAlertnessAbove, words: () => "the meal" },
  { active: (c) => hoursAwake(c) >= 1, words: (c) => `${hoursWord(hoursAwake(c))} awake` },
];

export function alertnessDrains(c: Context): string | null {
  const acting = ALERTNESS_DRAINS.filter((d) => d.active(c)).map((d) => d.words(c));
  return acting.length ? `Lowered by ${joinAnd(acting.slice(0, 2))}` : null;
}

export function glycogenShortfall(c: Context): string {
  const r = REFERENCE.liverGlycogen;
  const eatenEarlier = c.eaten.filter(
    (i) => foodKcalOf(i) >= REFERENCE.stillDigestingKcal && i.at < c.t - STOMACH.solidLagMin,
  );
  const hadLunch = c.eaten.some(
    (i) => i.at >= r.lunchFromMin && i.at < r.lunchUntilMin && foodKcalOf(i) >= r.lunchKcal,
  );
  if (c.t >= r.lunchUntilMin && c.t < 1440 && !hadLunch) return "You logged no lunch";
  return eatenEarlier.length
    ? `Your last food was at ${clock(eatenEarlier[eatenEarlier.length - 1].at)}`
    : "You have logged no food today";
}

export function nextVoid(c: Context): number | null {
  if (c.asleep) return null;
  const series = c.tr.series.bladderMl;
  return firstWhen(c, (m) => m < DAY.minutes && series[m + 1] < series[m] - KIDNEY.urineMlPerMin * 10);
}

export const minutesUntilSleep = (c: Context) =>
  firstWhen(c, (m) => POSTURES[Math.round(c.tr.series.posture[m])] === "sleeping") ?? DAY.minutes;
export const startedMuscleEvents = (c: Context) => c.tr.muscleEvents.filter((e) => e.from <= c.t);
export const sessionEnd = (e: BodyEvent) => endOf(e) ?? e.from;

export function sorenessPeak(c: Context): string | null {
  const ends = startedMuscleEvents(c).map(sessionEnd);
  if (!ends.length) return null;
  const peak = Math.max(...ends) + MUSCLE_RECOVERY.sorenessPeakH * 60;
  return peak > c.t ? `Peaks ${whenWords(peak, c.t)}` : null;
}

export const muscleLevel = (s: MuscleState) => Math.max(s.work, s.fatigue, s.soreness, s.repair);
export const groupsWhere = (c: Context, test: (s: MuscleState) => boolean): MuscleWork[] =>
  MUSCLE_GROUPS.flatMap((group) => {
    const state = muscleStateAt(c.tr.muscleEvents, group, c.t);
    return test(state) ? [{ group, load: muscleLevel(state) }] : [];
  });

export const anyMuscle = (c: Context, test: (s: MuscleState) => boolean) =>
  MUSCLE_GROUPS.some((group) => test(muscleStateAt(c.tr.muscleEvents, group, c.t)));
