import { crampLevel, cyclePhase, CyclePhase, lutealShare, minutesToNextPeriod } from "./cycle";
import { BodyEvent, ChannelId, curveStrength, effectAt, endOf, maxHeartRate, muscleStateAt, MuscleState, MuscleWork, namesOf, ResolvedEvent } from "./events";
import { MUSCLE_GROUPS, MUSCLE_LABEL, MuscleGroup } from "./muscleGroups";
import { ACTIVITY, BLOOD_FLOW, CAFFEINE, CYCLE, DAY, ENERGY, Evidence, FEELING_DISPLAY, HEART, INSULIN, KIDNEY, LIPID, MUSCLE_RECOVERY, PROCESS, REFERENCE, RESTING_SYSTOLIC_MMHG, STOMACH } from "./params";
import { drowsyFromMeal, drowsyFromSleepPressure, mealDipOf } from "./engine/feel";
import { heartFromCaffeine, heartFromDigestion } from "./engine/heart";
import { caffeineLedgerAt, intakeFlowsAt, SeriesName, Trajectory, value } from "./engine/trajectory";
import { foodKcalOf, Intake, kcalOf, Posture, POSTURES } from "./scenario";
import { postureKcalPerHour } from "./engine/anthropometrics";
import { OrganId, SystemId } from "./ids";
import { arrivingFoods, foodsInStomach } from "./whereabouts";
import { forecast as stateForecast } from "./forecast";
import { formatClock, hoursWord, inSentence, joinAnd, levelWord, theFoods, whenWords } from "./words";
import { systemById } from "./systems";
import type { ReadingId } from "./ids";

// Readings read from a curve in the table below. Muscle summaries are built per group.
type TableReadingId = Exclude<ReadingId, `muscle:${MuscleGroup}`>;

export type Verdict = "low" | "normal" | "expected" | "raised" | "high";
export type Trend = "rising" | "falling" | "steady";
// How loudly the interface should treat something. "calm" draws in ink, "note" in amber, "concern" in red.
export type Tone = "calm" | "note" | "concern";

export interface ReadingScale {
  min: number;
  max: number;
  typicalLow: number;
  typicalHigh: number;
  typicalLabel: string; // "3.9 to 7.8 mmol/L after a meal"
}

export interface Reading {
  id: ReadingId;
  label: string; // "Blood sugar"
  organ: OrganId | null; // what to highlight when this reading is hovered
  value: number;
  display: string; // "5.1"
  unit: string; // "mmol/L"
  trend: Trend;
  scale: ReadingScale;
  heading: number | null; // where it is going in the next hours, on the same scale
  verdict: Verdict;
  verdictWord: string; // "Normal", "Expected", "Slightly raised", "Low"
  tone: Tone;
  why: string; // "Sugar from the bar is arriving"
  forecast: string | null; // "Peaks at 6.9 near 17:41"
  forecastAt: number | null; // the minute that sentence is about, so the day chart can mark it
  forecastShort: string | null; // that sentence where room is tight
  evidence: Evidence;
  source: string; // where the typical range comes from, or "My estimate"
  series: SeriesName | null; // the curve this reading draws on the timeline
}

// A calm reading at zero has nothing to say: no alcohol, no reward signal. It stays off the screen.
export const hasSomethingToSay = (r: Reading) => r.tone !== "calm" || Number(r.display) !== 0;

export interface Feeling {
  id: string; // "full", "sleepy", "sore", "feverish", "coughing"
  label: string; // "Full"
  intensity: number; // 0 to 1
  word: string; // "Strong", "Mild", "Building"
  cause: string; // "Your stomach holds 530 ml"
  when: string | null; // "Peaks around 18:08"
  organ: OrganId | null;
  byClaude?: boolean; // Claude described it, for something with no built-in curve
}

export interface SystemStatus {
  word: string; // "Working hard", "Rising", "Quiet", shown in the rail
  level: number; // 0 to 1, how active this system is
  tone: Tone;
  quiet: boolean; // nothing going on
  sentence: string; // how this part of you is, in under 14 words and about this system only
  emphasis: boolean; // one of the three systems that matter most right now; the rail shows a word only for these
}

// One muscle group, for the Muscles system and for colouring the body.
export interface MuscleSummary extends MuscleState {
  group: MuscleGroup;
  label: string;
  status: string; // "Working", "Sore", "Tired", "Repairing", "Rested"
  level: number; // 0 to 1, the strongest of its states
  sorenessLine: string | null; // "Soreness peaks tomorrow evening"
  normalLine: string | null; // "Should feel normal in 5 days"
}

export interface Assessment {
  // One sentence that answers "what is going on" for the whole body right now.
  headline: string;
  // Only what stands out: empty when everything is unremarkable.
  notable: { text: string; tone: Tone; reading: ReadingId }[];
  readings: Reading[];
  feelings: Feeling[]; // strongest first, and only those worth mentioning
  systems: Record<SystemId, SystemStatus>;
  muscles: MuscleSummary[];
}

// Where the body is relative to food, which decides what counts as typical for most readings.
export type MealPhase = "fed" | "settling" | "fasting";

export interface Judgement {
  verdict: Verdict;
  word: string;
  tone: Tone;
}

const NORMAL: Judgement = { verdict: "normal", word: "Normal", tone: "calm" };
const EXPECTED: Judgement = { verdict: "expected", word: "Expected", tone: "calm" };
const SLIGHTLY_RAISED: Judgement = { verdict: "raised", word: "Slightly raised", tone: "note" };
const HIGH: Judgement = { verdict: "high", word: "High", tone: "concern" };
const LOW: Judgement = { verdict: "low", word: "Low", tone: "note" };
const quiet = (word: string): Judgement => ({ ...NORMAL, word });
// Off the person's own baseline yet inside the healthy range, so it gets a word and no colour.
const unpainted = (j: Judgement): Judgement => ({ ...j, tone: "calm" });

export function glucoseVerdict(mmol: number, context: { fasting: boolean; withinPeak: boolean; withinMeal: boolean; afterCarbs: boolean }): Judgement {
  const g = REFERENCE.glucose;
  if (mmol < g.veryLowMmol) return { verdict: "low", word: "Very low", tone: "concern" };
  if (mmol < g.fasting.low) return context.afterCarbs && mmol >= g.dip.floorMmol ? { verdict: "expected", word: "A dip", tone: "calm" } : LOW;
  if (context.fasting) {
    if (mmol >= g.fastingHighMmol) return HIGH;
    return mmol > g.fasting.high ? SLIGHTLY_RAISED : NORMAL;
  }
  if (mmol <= g.afterMeal.high) return NORMAL;
  if (mmol >= g.afterMealHighMmol || !context.withinMeal) return HIGH;
  return context.withinPeak ? EXPECTED : SLIGHTLY_RAISED;
}

export function insulinVerdict(fold: number, phase: MealPhase): Judgement {
  const r = REFERENCE.insulin;
  switch (phase) {
    case "fed":
      if (fold >= r.afterFoodHighFold) return HIGH;
      return fold > r.atRestBelowFold ? EXPECTED : NORMAL;
    case "settling":
      if (fold >= r.settlingHighFold) return SLIGHTLY_RAISED;
      return fold > r.fastingRaisedFold ? EXPECTED : NORMAL;
    case "fasting":
      if (fold >= r.fastingHighFold) return HIGH;
      return fold > r.fastingRaisedFold ? SLIGHTLY_RAISED : NORMAL;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

export function triglycerideVerdict(mgDl: number, context: { afterFattyMeal: boolean; fasting: boolean }): Judgement {
  const r = REFERENCE.triglycerides;
  if (mgDl > r.retestAbove) return HIGH;
  if (context.afterFattyMeal) return mgDl >= r.nonFastingHigh ? EXPECTED : NORMAL;
  if (context.fasting) {
    if (mgDl >= r.fastingVeryHigh) return HIGH;
    return mgDl >= r.fastingHigh ? SLIGHTLY_RAISED : NORMAL;
  }
  return mgDl >= r.nonFastingHigh ? SLIGHTLY_RAISED : NORMAL;
}

// A heart rate means something different depending on what is happening: 150 during training is
// expected, the same number at rest with nothing to explain it is high.
export function heartVerdict(bpm: number, context: { exerting: boolean; asleep: boolean; ownRestBpm: number; explainedBpm: number; maxBpm: number }): Judgement {
  const r = REFERENCE.heart;
  if (bpm >= context.maxBpm * r.nearMaximumShare) return { verdict: "raised", word: "Near your maximum", tone: "note" };
  if (context.exerting) return EXPECTED;
  const excess = bpm - context.ownRestBpm;
  if (bpm > r.high) return context.explainedBpm >= excess / 2 ? { verdict: "raised", word: "Raised", tone: "note" } : HIGH;
  if (bpm < r.low && !context.asleep) return unpainted(LOW);
  if (excess < r.raisedAboveOwnRestBpm) return NORMAL;
  return context.explainedBpm >= excess / 2 ? EXPECTED : unpainted(SLIGHTLY_RAISED);
}

// What every table row can look at: the moment, and what is acting on the body.
interface Context {
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
interface Sample {
  raw: number;
  value: number;
  trend: Trend;
}

// A reason table reads top to bottom and the first passing row wins, so order is priority. New
// causes join a table as new rows; the last row of each table always passes.
type ReasonRow = readonly [test: (c: Context, s: Sample) => boolean, text: (c: Context, s: Sample) => string];
const always = () => true;

// A forecast table works the same way: the first rule with something to say wins.
type ForecastRule = (c: Context, s: Sample, series: SeriesName) => Said | null;
interface Said {
  text: string;
  short: string; // the same thing where room is tight: "Peaks at 6.9 17:53"
  at: number | null;
}
const near = (text: string, at: number): Said => ({ text: `${text} near ${clock(at)}`, short: `${text} ${clock(at)}`, at });

interface ReadingRange extends ReadingScale {
  evidence: Evidence;
  source: string;
}

interface ReadingSpec {
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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clock = formatClock;
const toMmol = (mgDl: number) => mgDl / REFERENCE.mgDlPerMmolGlucose;
const identity = (x: number) => x;
const fixed = (digits: number) => (x: number) => x.toFixed(digits);
const rounded = (x: number) => String(Math.round(x));
const tens = (x: number) => String(Math.round(x / 10) * 10);
const perHour = (gPerMin: number) => gPerMin * 60;
const percentOf = (x: number) => x * 100;
const gramsPerHourFromMg = (mgPerMin: number) => (mgPerMin / 1000) * 60;

function contextAt(tr: Trajectory, t: number): Context {
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
    phase: digesting || sinceFood <= REFERENCE.fedAfterFoodMin ? "fed" : sinceFood < REFERENCE.fastingAfterMin ? "settling" : "fasting",
    eaten,
    lastFood,
    carbsPeaking: sinceCarbs <= REFERENCE.glucose.peakWindowMin,
    afterCarbs: sinceCarbs <= REFERENCE.glucose.dip.windowMin,
    carbsActive: sinceCarbs <= REFERENCE.glucose.mealWindowMin || v("glucoseAbsorbMgMin") > REFERENCE.glucose.stillAbsorbingMgPerMin,
    afterFattyMeal: sinceFat <= REFERENCE.triglycerides.fatWindowMin,
  };
}

const firstMinute = (c: Context) => Math.max(0, Math.min(DAY.minutes, Math.ceil(c.t)));

function extremeAhead(c: Context, name: SeriesName, kind: "max" | "min", horizon: number = REFERENCE.headingHorizonMin) {
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
function peakAhead(c: Context, name: SeriesName, minRise: number, horizon?: number) {
  const peak = extremeAhead(c, name, "max", horizon);
  return peak.at > c.t + 2 && peak.value - c.v(name) >= minRise ? peak : null;
}

function firstWhen(c: Context, test: (minute: number) => boolean): number | null {
  for (let m = firstMinute(c); m <= DAY.minutes; m++) if (test(m)) return m;
  return null;
}

function headingOf(c: Context, spec: ReadingSpec): number | null {
  if (spec.headingChange === null) return null;
  const now = c.v(spec.series);
  const high = extremeAhead(c, spec.series, "max").value;
  const low = extremeAhead(c, spec.series, "min").value;
  const farther = high - now >= now - low ? high : low;
  return Math.abs(farther - now) < spec.headingChange ? null : spec.toValue(farther, c);
}

function trendOf(c: Context, spec: ReadingSpec): Trend {
  const change = c.v(spec.series, c.t + REFERENCE.trendWindowMin) - c.v(spec.series, c.t - REFERENCE.trendWindowMin);
  if (change > spec.trendEpsilon) return "rising";
  return change < -spec.trendEpsilon ? "falling" : "steady";
}

const peaksAt =
  (minRise: number, text: (raw: number) => string, horizon?: number, above?: (c: Context) => number): ForecastRule =>
  (c, _s, series) => {
    const peak = peakAhead(c, series, minRise, horizon);
    if (!peak || (above && peak.value <= above(c))) return null;
    return near(text(peak.value), peak.at);
  };

// The first minute the curve passes a test, once the guard says it is worth saying.
const reaches =
  (guard: (c: Context, s: Sample) => boolean, test: (raw: number, c: Context) => boolean, text: (raw: number) => string): ForecastRule =>
  (c, s, series) => {
    if (!guard(c, s)) return null;
    const at = firstWhen(c, (m) => test(c.tr.series[series][m], c));
    return at === null ? null : near(text(c.tr.series[series][at]), at);
  };

const foodsNowArriving = (c: Context, nutrient: "carbs" | "fat") => arrivingFoods(c.tr, c.t, nutrient);

function caffeineLeft(c: Context) {
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

const caffeinePresent = (c: Context) => c.v("caffeine") >= REFERENCE.caffeine.presentAboveMgL || caffeineLeft(c).left >= 1;
const costsSleep = (c: Context) => caffeinePresent(c) && c.t < DAY.sleepMin && c.v("caffeine", DAY.sleepMin) >= CAFFEINE.sleepConcernMgL;
const caffeineDoseMgL = (c: Context, doseMg: number) => doseMg / (CAFFEINE.volumeLPerKg * c.tr.scenario.body.weightKg);
const nearestMinute = (c: Context) => Math.max(0, Math.min(DAY.minutes, Math.round(c.t)));
const ownRestBpm = (c: Context, posture: Posture = c.posture) => c.tr.anthro.restingBpm + HEART.byActivity[posture];
const digesting = (c: Context) => c.v("digestion") > 0.05;

const hoursAwake = (c: Context) => c.v("hoursAwake");

const POSTURE_WORD: Record<Posture, string> = { sleeping: "Sleep", sitting: "Sitting", standing: "Standing", walking: "Walking", running: "Running" };

// The event pushing a channel the most right now, for a reason to name.
function topCause(c: Context, channel: ChannelId, atLeast: number): ResolvedEvent | null {
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

const causeOf = (c: Context, channel: ChannelId, atLeast: number) => topCause(c, channel, atLeast)?.causeName ?? null;
const startedBy = (channel: ChannelId, atLeast: number) => (c: Context) => topCause(c, channel, atLeast) !== null;

// A reason row naming whichever event is pushing this channel.
const causedBy = (channel: ChannelId, atLeast: number, text: (cause: string, amount: number) => string): ReasonRow => [
  startedBy(channel, atLeast),
  (c) => {
    const event = topCause(c, channel, atLeast);
    return event ? text(event.causeName, effectAt(event, channel, c.t)) : "";
  },
];

const raises = (cause: string) => `Raised by ${cause}`;

// What the luteal phase is adding to a channel. Only heart rate and temperature ever get named.
function fromCycle(c: Context, channel: ChannelId, at = c.t): number {
  if (!c.tr.cycle) return 0;
  const size = channel === "heartRate" ? CYCLE.luteal.heartBpm : channel === "temperature" ? CYCLE.luteal.temperatureC : 0;
  return size * lutealShare(c.tr.cycle, at);
}

// What a walk or run is adding to a channel, including what lingers after you stop.
function fromMoving(c: Context, channel: ChannelId, at = c.t): number {
  const fromEvents = c.events.reduce((sum, e) => sum + effectAt(e, channel, at), 0);
  return Math.max(0, c.tr.channels[channel][Math.max(0, Math.min(DAY.minutes - 1, Math.round(at)))] - fromEvents - fromCycle(c, channel, at));
}

// "running" or "walking": whichever you did last, for naming what still lingers.
function movedWord(c: Context): string {
  const moved = [...c.tr.scenario.activities].sort((a, b) => a.from - b.from).filter((span) => span.from <= c.t && (span.posture === "walking" || span.posture === "running"));
  const last = moved[moved.length - 1];
  return last ? POSTURE_WORD[last.posture].toLowerCase() : "moving";
}

// What is pushing the heart above its plain resting rate, biggest first. Events are rows of their own.
function heartCauses(c: Context): { name: string; bpm: number }[] {
  const fixedRows = [
    { name: movedWord(c), bpm: fromMoving(c, "heartRate") },
    { name: "digestion", bpm: heartFromDigestion(c.v("digestion")) },
    { name: "caffeine", bpm: heartFromCaffeine(c.v("caffeine")) },
    { name: "your cycle", bpm: fromCycle(c, "heartRate") },
  ];
  const named = (e: ResolvedEvent) => (e.preset === "illness" && effectAt(e, "temperature", c.t) >= PROCESS.feverNamedFromC ? "the fever" : e.causeName);
  const rows = c.events.map((e) => ({ name: named(e), bpm: effectAt(e, "heartRate", c.t) }));
  return [...fixedRows, ...rows].filter((row) => row.bpm >= 1).sort((a, b) => b.bpm - a.bpm);
}

function heartReason(c: Context): string | null {
  const [first, second] = heartCauses(c);
  if (!first) return null;
  const one = `About ${Math.round(first.bpm)} bpm from ${first.name}`;
  if (!second) return one;
  const both = `${one}, ${Math.round(second.bpm)} from ${second.name}`;
  return both.split(/\s+/).length <= PROCESS.reasonWordsMost ? both : one;
}

function eventHeartBpm(c: Context) {
  return c.events.reduce((sum, e) => sum + effectAt(e, "heartRate", c.t), 0);
}

// What is pulling alertness down. Ordered as it reads in a sentence.
const ALERTNESS_DRAINS: { active: (c: Context) => boolean; words: (c: Context) => string }[] = [
  { active: startedBy("drowsiness", PROCESS.eventDrowsinessNamedFrom), words: (c) => causeOf(c, "drowsiness", PROCESS.eventDrowsinessNamedFrom) ?? "" },
  { active: (c) => c.v("mealDip") >= PROCESS.mealPullsAlertnessAbove, words: () => "the meal" },
  { active: (c) => hoursAwake(c) >= 1, words: (c) => `${hoursWord(hoursAwake(c))} awake` },
];

function alertnessDrains(c: Context): string | null {
  const acting = ALERTNESS_DRAINS.filter((d) => d.active(c)).map((d) => d.words(c));
  return acting.length ? `Lowered by ${joinAnd(acting.slice(0, 2))}` : null;
}

function glycogenShortfall(c: Context): string {
  const r = REFERENCE.liverGlycogen;
  const eatenEarlier = c.eaten.filter((i) => foodKcalOf(i) >= REFERENCE.stillDigestingKcal && i.at < c.t - STOMACH.solidLagMin);
  const hadLunch = c.eaten.some((i) => i.at >= r.lunchFromMin && i.at < r.lunchUntilMin && foodKcalOf(i) >= r.lunchKcal);
  if (c.t >= r.lunchUntilMin && c.t < 1440 && !hadLunch) return "You logged no lunch";
  return eatenEarlier.length ? `Your last food was at ${clock(eatenEarlier[eatenEarlier.length - 1].at)}` : "You have logged no food today";
}

function nextVoid(c: Context): number | null {
  if (c.asleep) return null;
  const series = c.tr.series.bladderMl;
  return firstWhen(c, (m) => m < DAY.minutes && series[m + 1] < series[m] - KIDNEY.urineMlPerMin * 10);
}

// One row per share of the blood. They read alike, so one builder makes all four.
function bloodShareSpec(id: "flowGut" | "flowMuscle" | "flowBrain" | "flowKidneys", label: string, organ: OrganId, band: { low: number; high: number; max: number }, why: readonly ReasonRow[], forecast: readonly ForecastRule[] = []): ReadingSpec {
  const r = REFERENCE.bloodFlow;
  return {
    label,
    organ,
    series: id,
    unit: "% of blood",
    toValue: percentOf,
    format: rounded,
    trendEpsilon: 0.002,
    headingChange: 0.015,
    range: () => ({ min: 0, max: band.max, typicalLow: band.low, typicalHigh: band.high, typicalLabel: `${band.low} to ${band.high}% at rest`, evidence: r.evidence, source: r.source }),
    judge: (c, s) => ((s.value < band.low || s.value > band.high) && (digesting(c) || c.moving || c.exerting || c.v("stressLevel") >= 0.1) ? EXPECTED : NORMAL),
    why,
    forecast,
  };
}

const glucoseSpec: ReadingSpec = {
  label: "Blood sugar",
  organ: "pancreas",
  series: "glucose",
  unit: "mmol/L",
  toValue: toMmol,
  format: fixed(1),
  trendEpsilon: 1,
  headingChange: 2,
  range: (c) => {
    const r = REFERENCE.glucose;
    const band = c.phase === "fasting" ? r.fasting : r.afterMeal;
    return { ...r.scale, typicalLow: band.low, typicalHigh: band.high, typicalLabel: band.label, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => glucoseVerdict(s.value, { fasting: c.phase === "fasting", withinPeak: c.carbsPeaking, withinMeal: c.carbsActive, afterCarbs: c.afterCarbs }),
  why: [
    [(c, s) => foodsNowArriving(c, "carbs").length > 0 && s.trend === "rising", (c) => `Sugar from ${theFoods(foodsNowArriving(c, "carbs"))} is arriving`],
    [(c, s) => c.moving && (s.trend === "falling" || s.raw < c.tr.anthro.baselineGlucose - 3), () => "Your moving muscles are pulling sugar out"],
    [(c, s) => foodsNowArriving(c, "carbs").length > 0 && s.trend === "falling", () => "Insulin is moving sugar into muscle and liver"],
    [(c) => foodsNowArriving(c, "carbs").length > 0, () => "Sugar arriving matches what your cells take"],
    [(c) => foodsInStomach(c.tr, c.t).length > 0, () => "Food hasn't reached your intestine yet"],
    [(c, s) => s.raw < c.tr.anthro.baselineGlucose - 3 && c.lastFood !== null && c.t - c.lastFood.at < REFERENCE.fastingAfterMin, () => "A small dip after the meal"],
    [(c, s) => s.raw < c.tr.anthro.baselineGlucose - 3 && c.v("liverGlycogen") < REFERENCE.liverGlycogen.low, () => "Your liver is running low on sugar"],
    [(c, s) => s.raw < c.tr.anthro.baselineGlucose - 3, () => "A small dip. Your liver is topping it up"],
    [(c, s) => s.raw > c.tr.anthro.baselineGlucose + 3 && startedBy("liverOutput", 0.03)(c), (c) => `Raised a little by ${causeOf(c, "liverOutput", 0.03) ?? ""}`],
    [(c, s) => s.raw > c.tr.anthro.baselineGlucose + 3 && startedBy("insulinSensitivity", 0.1)(c), (c) => `Slowed by ${causeOf(c, "insulinSensitivity", 0.1) ?? ""}`],
    [(c, s) => s.raw > c.tr.anthro.baselineGlucose + 3, () => "Insulin is bringing it back down"],
    [(c) => c.asleep, () => "Your liver feeds your blood while you sleep"],
    [always, (c) => (c.lastFood ? "Your liver is holding it steady between meals" : "Your liver is holding it steady from stores")],
  ],
  forecast: [
    // Climbing back from a dip is a recovery, so only a rise above the resting level is a peak.
    peaksAt(2, (raw) => `Peaks at ${toMmol(raw).toFixed(1)}`, undefined, (c) => c.tr.anthro.baselineGlucose + 3),
    reaches(
      (c, s) => Math.abs(s.raw - c.tr.anthro.baselineGlucose) > 3,
      (raw, c) => Math.abs(raw - c.tr.anthro.baselineGlucose) <= 3,
      (raw) => `Back to ${toMmol(raw).toFixed(1)}`,
    ),
  ],
};

const insulinRaised = (s: Sample) => s.value > REFERENCE.insulin.atRestBelowFold;

const insulinSpec: ReadingSpec = {
  label: "Insulin",
  organ: "pancreas",
  series: "insulin",
  unit: "× rest",
  toValue: (raw) => raw / INSULIN.baselineUUPerMl,
  format: fixed(1),
  trendEpsilon: 0.4,
  headingChange: INSULIN.baselineUUPerMl * 0.3,
  range: (c) => {
    const r = REFERENCE.insulin;
    if (c.phase === "fasting") {
      const typicalLow = r.fastingUUPerMl.low / INSULIN.baselineUUPerMl;
      const typicalHigh = r.fastingUUPerMl.high / INSULIN.baselineUUPerMl;
      return { ...r.scale, typicalLow, typicalHigh, typicalLabel: `Under ${typicalHigh.toFixed(1)}× rest fasting`, evidence: r.fastingEvidence, source: r.fastingSource };
    }
    return { ...r.scale, typicalLow: r.afterFoodTypicalFold.low, typicalHigh: r.afterFoodTypicalFold.high, typicalLabel: "Rises after food", evidence: r.afterFoodEvidence, source: r.afterFoodSource };
  },
  judge: (c, s) => insulinVerdict(s.value, c.phase),
  why: [
    [(_c, s) => insulinRaised(s) && s.trend === "falling", () => "Sugar is easing, so your pancreas is easing off"],
    [(_c, s) => insulinRaised(s), () => "It's following the sugar"],
    [(c) => foodsNowArriving(c, "carbs").length > 0 || foodsInStomach(c.tr, c.t).length > 0, () => "Insulin rises as sugar arrives"],
    [(_c, s) => s.value < REFERENCE.insulin.loweredBelowFold, () => "Lower after a long time without food"],
    [always, () => "At its resting level"],
  ],
  forecast: [
    peaksAt(INSULIN.baselineUUPerMl * 0.3, (raw) => `Peaks at ${(raw / INSULIN.baselineUUPerMl).toFixed(1)}×`),
    reaches(
      (_c, s) => insulinRaised(s),
      (raw) => raw / INSULIN.baselineUUPerMl <= REFERENCE.insulin.atRestBelowFold,
      () => "Back to rest",
    ),
  ],
};

function fatStillComingG(c: Context) {
  let grams = 0;
  for (const intake of c.eaten) {
    const flows = intakeFlowsAt(c.tr, intake.id, c.t);
    if (flows) grams += flows.stomachFat + flows.gutFat;
  }
  return grams;
}

const tgOverRest = (c: Context, s: Sample) => s.raw - c.tr.anthro.baselineTg;

const triglycerideSpec: ReadingSpec = {
  label: "Blood fat",
  organ: "fat",
  series: "tg",
  unit: "mg/dL",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 3,
  range: (c) => {
    const r = REFERENCE.triglycerides;
    const fasting = c.phase === "fasting";
    return {
      ...r.scale,
      typicalLow: 0,
      typicalHigh: fasting ? r.fastingHigh : r.nonFastingHigh,
      typicalLabel: fasting ? `Under ${r.fastingHigh} mg/dL fasting` : `Under ${r.nonFastingHigh} mg/dL, higher for hours after fat`,
      evidence: r.evidence,
      source: r.source,
    };
  },
  judge: (c, s) => triglycerideVerdict(s.raw, { afterFattyMeal: c.afterFattyMeal, fasting: c.phase === "fasting" }),
  why: [
    [(c, s) => tgOverRest(c, s) < REFERENCE.triglycerides.arrivedAboveRestMgDl && fatStillComingG(c) >= REFERENCE.triglycerides.fatMealG, () => "The meal's fat hasn't arrived yet"],
    [(c, s) => s.trend === "rising" && foodsNowArriving(c, "fat").length > 0, (c) => `Fat from ${theFoods(foodsNowArriving(c, "fat"))} is arriving`],
    [(c, s) => tgOverRest(c, s) >= REFERENCE.triglycerides.clearingAboveRestMgDl, () => "Your fat tissue is pulling meal fat out"],
    [always, () => "No meal fat in your blood"],
  ],
  forecast: [
    peaksAt(3, (raw) => `Peaks at ${Math.round(raw)}`, DAY.minutes),
    reaches(
      (_c, s) => s.raw >= REFERENCE.triglycerides.fastingHigh,
      (raw) => raw < REFERENCE.triglycerides.fastingHigh,
      () => `Back under ${REFERENCE.triglycerides.fastingHigh}`,
    ),
  ],
};

const heartSpec: ReadingSpec = {
  label: "Heart rate",
  organ: "heart",
  series: "hr",
  unit: "bpm",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 2,
  range: () => {
    const r = REFERENCE.heart;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} bpm at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => heartVerdict(s.raw, { exerting: c.exerting || c.moving, asleep: c.asleep, ownRestBpm: ownRestBpm(c), explainedBpm: heartCauses(c).reduce((sum, cause) => sum + cause.bpm, 0), maxBpm: maxHeartRate(c.tr.scenario.body.age) }),
  why: [
    [(c) => heartReason(c) !== null, (c) => heartReason(c) ?? ""],
    [(c) => c.asleep, () => "Your heart slows while you sleep"],
    [always, () => "Your usual rate at rest"],
  ],
  forecast: [
    (c, s) => {
      if (s.raw - ownRestBpm(c) < 2) return null;
      const at = firstWhen(c, (m) => c.tr.series.hr[m] - ownRestBpm(c, POSTURES[Math.round(c.tr.series.posture[m])]) < 1.5);
      return at === null ? null : near(`Back to ${Math.round(c.tr.series.hr[at])}`, at);
    },
  ],
};

const outputRaised = (c: Context, s: Sample) => s.raw - (ownRestBpm(c) * s.raw) / c.v("hr") >= REFERENCE.cardiacOutput.raisedAboveOwnRestL;

const outputSpec: ReadingSpec = {
  label: "Heart output",
  organ: "heart",
  series: "cardiacOutput",
  unit: "L/min",
  toValue: identity,
  format: fixed(1),
  trendEpsilon: 0.05,
  headingChange: 0.2,
  range: (c) => {
    const r = REFERENCE.cardiacOutput;
    const band = c.tr.scenario.body.sex === "male" ? r.male : r.female;
    return { ...r.scale, typicalLow: band.low, typicalHigh: band.high, typicalLabel: `${band.low} to ${band.high} L/min at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.cardiacOutput;
    const band = c.tr.scenario.body.sex === "male" ? r.male : r.female;
    if (c.moving || c.exerting) return EXPECTED;
    if (s.raw > band.high) return SLIGHTLY_RAISED;
    return outputRaised(c, s) ? EXPECTED : NORMAL;
  },
  why: [
    [(c) => c.moving || c.training !== null, () => "Your muscles need more blood"],
    causedBy("heartRate", 3, (cause) => `Working harder because of ${cause}`),
    [(c, s) => outputRaised(c, s), () => "Your heart beats faster to feed the gut"],
    [always, () => "Your usual output at rest"],
  ],
  forecast: [],
};

const breathingSpec: ReadingSpec = {
  label: "Breathing",
  organ: "lungs",
  series: "breaths",
  unit: "a minute",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.2,
  headingChange: 1,
  range: () => {
    const r = REFERENCE.breathing;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} a minute at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.breathing;
    if (c.moving || c.exerting) return EXPECTED;
    if (s.raw > r.high) return SLIGHTLY_RAISED;
    return s.raw < r.low && !c.asleep ? unpainted(LOW) : NORMAL;
  },
  why: [
    [(c) => c.moving || c.training !== null, () => "Your muscles need more oxygen"],
    causedBy("breathing", 1, (cause) => `Faster because of ${cause}`),
    [(c) => c.asleep, () => "You breathe slower asleep"],
    [(c, s) => s.raw - HEART.breathsByActivity[c.posture] >= 0.5, () => "Digesting uses extra oxygen"],
    [always, () => "Your usual rate at rest"],
  ],
  forecast: [],
};

const flowLitres = (c: Context, s: Sample) => (s.raw * c.v("cardiacOutput")).toFixed(1);
const gutPulled = (s: Sample) => s.value > REFERENCE.bloodFlow.digestingAbovePercent;

const gutShareSpec = bloodShareSpec(
  "flowGut",
  "Blood to gut",
  "small_intestine",
  REFERENCE.bloodFlow.gut,
  [
    [(c) => c.moving || c.training !== null, () => "Your working muscles are taking the blood"],
    [(_c, s) => gutPulled(s), () => "Digestion pulls more blood to your gut"],
    [always, () => "Its usual share at rest"],
  ],
  [
    reaches(
      (_c, s) => gutPulled(s),
      (raw) => raw <= BLOOD_FLOW.rest.gut + 0.01,
      (raw) => `Back to ${Math.round(raw * 100)}%`,
    ),
  ],
);

const stomachKcalText = (c: Context) => tens(c.v("stomachKcal"));

const stomachSpec: ReadingSpec = {
  label: "Stomach",
  organ: "stomach",
  series: "stomachMl",
  unit: "ml",
  toValue: identity,
  format: tens,
  trendEpsilon: 2,
  headingChange: 20,
  range: (c) => {
    const r = REFERENCE.stomach;
    const fastingHigh = r.fastingHighMlPerKg * c.tr.scenario.body.weightKg;
    return { min: 0, max: STOMACH.fullnessMl, typicalLow: 0, typicalHigh: c.v("stomachKcal") > REFERENCE.stillDigestingKcal ? STOMACH.fullnessMl : fastingHigh, typicalLabel: `Under ${tens(fastingHigh)} ml empty, about 1 L after a meal`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => {
    const r = REFERENCE.stomach;
    if (s.raw > r.veryFullMl) return { verdict: "raised", word: "Very full", tone: "note" };
    return s.raw <= STOMACH.restingVolumeMl + r.emptyAboveRestingMl ? quiet("Empty") : EXPECTED;
  },
  why: [
    [(c) => c.v("stomachKcal") > REFERENCE.stillDigestingKcal && c.v("emptyingKcalPerMin") <= 0.05, (c) => `Holding ${stomachKcalText(c)} kcal. The outlet opens in minutes`],
    [(c) => c.v("stomachKcal") > REFERENCE.stillDigestingKcal, (c) => `Holding ${stomachKcalText(c)} kcal from ${theFoods(foodsInStomach(c.tr, c.t))}`],
    [(_c, s) => s.raw <= STOMACH.restingVolumeMl + REFERENCE.stomach.emptyAboveRestingMl, () => "Empty and resting"],
    [always, () => "Passing liquid through"],
  ],
  forecast: [
    (c) => {
      const empties = stateForecast(c.tr, c.t).stomachEmpty;
      return empties === null ? null : near("Empty", empties);
    },
  ],
};

const absorbingQuiet = (s: Sample) => s.value < 0.5;
const fatCrossing = (c: Context) => perHour(c.v("fatAbsorbGMin")) >= REFERENCE.absorption.fatShownAboveGPerH;

const absorbingSpec: ReadingSpec = {
  label: "Absorbing sugar",
  organ: "small_intestine",
  series: "carbAbsorbMgMin",
  unit: "g/h",
  toValue: gramsPerHourFromMg,
  format: rounded,
  trendEpsilon: 3,
  headingChange: 20,
  range: () => {
    const r = REFERENCE.absorption;
    return { ...r.scale, typicalLow: 0, typicalHigh: r.high, typicalLabel: `Up to about ${r.high} g an hour`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => {
    if (s.value > REFERENCE.absorption.high) return { verdict: "raised", word: "Fast", tone: "note" };
    return absorbingQuiet(s) ? quiet("Quiet") : EXPECTED;
  },
  why: [
    [(c, s) => !absorbingQuiet(s) && foodsNowArriving(c, "carbs").length > 0, (c) => `Absorbing sugar from ${theFoods(foodsNowArriving(c, "carbs"))}`],
    [(c) => fatCrossing(c), () => "The sugar has crossed. Fat is still crossing"],
    [(c) => foodsInStomach(c.tr, c.t).length > 0, () => "Food hasn't reached your intestine yet"],
    [always, () => "Nothing to absorb right now"],
  ],
  forecast: [
    peaksAt(20, (raw) => `Peaks at ${Math.round(gramsPerHourFromMg(raw))} g an hour`),
    reaches(
      (_c, s) => !absorbingQuiet(s),
      (raw) => gramsPerHourFromMg(raw) < 0.5,
      () => "Finishes",
    ),
  ],
};

const glycogenLow = (s: Sample) => s.value < REFERENCE.liverGlycogen.low;

const glycogenSpec: ReadingSpec = {
  label: "Liver fuel",
  organ: "liver",
  series: "liverGlycogen",
  unit: "g",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.15,
  headingChange: 2,
  range: () => {
    const r = REFERENCE.liverGlycogen;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: "Stored as glycogen: about 50 g after a night, 80 g after a meal", evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => (glycogenLow(s) ? LOW : NORMAL),
  why: [
    [(_c, s) => glycogenLow(s) && s.trend === "rising", (c) => `${glycogenShortfall(c)}. Refilling now`],
    [(_c, s) => glycogenLow(s), (c) => glycogenShortfall(c)],
    [(c, s) => s.trend === "rising" && foodsNowArriving(c, "carbs").length > 0, (c) => `Storing sugar from ${theFoods(foodsNowArriving(c, "carbs"))}`],
    [(_c, s) => s.trend === "rising", () => "Storing sugar after the meal"],
    [(c) => c.asleep, () => "Feeding your brain while you sleep"],
    [always, () => "Feeding your blood between meals"],
  ],
  forecast: [
    peaksAt(2, (raw) => `Refills to ${Math.round(raw)} g`),
    reaches(
      (_c, s) => !glycogenLow(s) && s.trend === "falling",
      (raw) => raw < REFERENCE.liverGlycogen.low,
      () => `Reaches ${REFERENCE.liverGlycogen.low} g`,
    ),
  ],
};

const muscleQuiet = (s: Sample) => s.value < REFERENCE.muscleUptake.quietBelowGPerH;

const muscleUptakeSpec: ReadingSpec = {
  label: "Muscles taking sugar",
  organ: "muscle",
  series: "muscleUptakeGMin",
  unit: "g/h",
  toValue: perHour,
  format: rounded,
  trendEpsilon: 0.004,
  headingChange: 0.02,
  range: () => {
    const r = REFERENCE.muscleUptake;
    return { ...r.scale, typicalLow: 0, typicalHigh: r.highAtRestGPerH, typicalLabel: `Under ${r.highAtRestGPerH} g an hour at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => (muscleQuiet(s) ? quiet("Quiet") : EXPECTED),
  why: [
    [(c) => c.moving || c.training !== null, () => "Moving muscles pull sugar in with little insulin"],
    [(_c, s) => muscleQuiet(s), () => "Resting muscles take almost no sugar without insulin"],
    [(c) => c.posture === "sitting", () => "Insulin is opening them, slowly while you sit"],
    [always, () => "Insulin is opening them to sugar"],
  ],
  forecast: [peaksAt(0.02, (raw) => `Peaks at ${Math.round(perHour(raw))} g an hour`)],
};

const kcalAtMet = (c: Context, met: number) => postureKcalPerHour(c.tr.anthro.bmrKcalPerDay, c.tr.scenario.body.weightKg, met);
const postureKcal = (c: Context) => kcalAtMet(c, ENERGY.mets[c.posture]);
const eventKcal = (c: Context) => postureKcal(c) * c.tr.channels.metabolism[nearestMinute(c)];
const digestingKcal = (c: Context, s: Sample) => s.raw - postureKcal(c) - eventKcal(c);

const burnSpec: ReadingSpec = {
  label: "Energy burn",
  organ: "muscle",
  series: "kcalPerHour",
  unit: "kcal/h",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 5,
  range: (c) => {
    const r = REFERENCE.burn;
    const typicalLow = kcalAtMet(c, ENERGY.mets.sleeping);
    const typicalHigh = kcalAtMet(c, ENERGY.mets.standing);
    return { ...r.scale, typicalLow, typicalHigh, typicalLabel: `${Math.round(typicalLow)} to ${Math.round(typicalHigh)} kcal an hour at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => (c.moving || eventKcal(c) >= REFERENCE.burn.thermicNoticedKcal || digestingKcal(c, s) >= REFERENCE.burn.thermicNoticedKcal ? EXPECTED : NORMAL),
  why: [
    [(c) => eventKcal(c) >= REFERENCE.burn.thermicNoticedKcal && startedBy("metabolism", 0.01)(c), (c) => `About ${Math.round(eventKcal(c))} kcal/h from ${causeOf(c, "metabolism", 0.01) ?? ""}`],
    [(c, s) => digestingKcal(c, s) >= REFERENCE.burn.thermicNoticedKcal, (c, s) => `${POSTURE_WORD[c.posture]} burns about ${Math.round(postureKcal(c))} kcal an hour, digesting adds ${Math.round(digestingKcal(c, s))}`],
    [always, (c) => `${POSTURE_WORD[c.posture]} burns about ${Math.round(postureKcal(c))} kcal an hour`],
  ],
  forecast: [],
};

const FUEL_REST_PERCENT = ENERGY.carbFuelBase * 100;
const fuelTipped = (s: Sample) => s.value > FUEL_REST_PERCENT + 3;

const fuelSpec: ReadingSpec = {
  label: "Burning sugar",
  organ: "muscle",
  series: "carbFuel",
  unit: "% of energy",
  toValue: percentOf,
  format: rounded,
  trendEpsilon: 0.005,
  headingChange: 0.03,
  range: () => {
    const r = REFERENCE.fuel;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `About ${r.low} to ${r.high}% at rest, the rest is fat`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => (s.value > REFERENCE.fuel.high ? EXPECTED : NORMAL),
  why: [
    [(c) => c.training !== null, () => "Hard work runs mostly on sugar"],
    [(_c, s) => fuelTipped(s), () => "Insulin tips your cells toward burning sugar"],
    [always, () => "At rest you burn more fat than sugar"],
  ],
  forecast: [
    reaches(
      (_c, s) => fuelTipped(s),
      (raw) => raw * 100 <= FUEL_REST_PERCENT + 1,
      (raw) => `Back to ${Math.round(raw * 100)}%`,
    ),
  ],
};

const caffeineSpec: ReadingSpec = {
  label: "Caffeine",
  organ: "brain",
  series: "caffeine",
  unit: "mg/L",
  toValue: identity,
  format: fixed(2),
  trendEpsilon: 0.005,
  headingChange: 0.05,
  range: (c) => {
    const r = REFERENCE.caffeine;
    const typicalHigh = caffeineDoseMgL(c, r.singleDoseMg);
    return { min: 0, max: r.scaleMaxMgL, typicalLow: 0, typicalHigh, typicalLabel: `Under ${typicalHigh.toFixed(1)} mg/L, a ${r.singleDoseMg} mg dose for you`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.caffeine;
    if (s.raw >= caffeineDoseMgL(c, r.dailyDoseMg)) return HIGH;
    if (s.raw >= caffeineDoseMgL(c, r.singleDoseMg)) return SLIGHTLY_RAISED;
    if (costsSleep(c)) return { ...EXPECTED, tone: "note" };
    return caffeinePresent(c) ? EXPECTED : quiet("None");
  },
  why: [
    [(c) => !caffeinePresent(c), () => "No caffeine in your blood"],
    [
      (c) => c.eaten.filter((i) => i.caffeineMg > 0).length === 1,
      (c) => {
        const drink = c.eaten.filter((i) => i.caffeineMg > 0)[0];
        const { left, dose } = caffeineLeft(c);
        return `Your ${inSentence(drink.label)} at ${clock(drink.at)}. ${Math.round(left)} of ${Math.round(dose)} mg left`;
      },
    ],
    [
      always,
      (c) => {
        const { left, dose } = caffeineLeft(c);
        return `${Math.round(left)} of the ${Math.round(dose)} mg you drank is left`;
      },
    ],
  ],
  forecast: [
    (c) => {
      if (!caffeinePresent(c) || c.t >= DAY.sleepMin) return null;
      const atBed = c.v("caffeine", DAY.sleepMin);
      return { text: costsSleep(c) ? `Still ${atBed.toFixed(1)} mg/L at ${clock(DAY.sleepMin)}, which may cost you sleep` : `${atBed.toFixed(2)} mg/L left by ${clock(DAY.sleepMin)}`, short: `${atBed.toFixed(costsSleep(c) ? 1 : 2)} mg/L at ${clock(DAY.sleepMin)}`, at: DAY.sleepMin };
    },
  ],
};

const receptorsClear = (s: Sample) => s.value < REFERENCE.receptors.clearBelowPercent;

const receptorsSpec: ReadingSpec = {
  label: "Tired signal blocked",
  organ: "brain",
  series: "occupancy",
  unit: "%",
  toValue: percentOf,
  format: rounded,
  trendEpsilon: 0.002,
  headingChange: 0.02,
  range: () => {
    const r = REFERENCE.receptors;
    return { min: 0, max: 100, typicalLow: 0, typicalHigh: r.high, typicalLabel: `Up to about ${r.high}% from several cups a day`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => {
    if (s.value >= REFERENCE.receptors.high) return SLIGHTLY_RAISED;
    return receptorsClear(s) ? quiet("Clear") : EXPECTED;
  },
  why: [
    [(_c, s) => receptorsClear(s), () => "No caffeine in the way"],
    [always, () => "Caffeine sits where the tired signal would land"],
  ],
  forecast: [
    peaksAt(0.02, (raw) => `Peaks at ${Math.round(raw * 100)}%`),
    reaches(
      (_c, s) => s.value >= 2,
      (raw) => raw * 100 < 1,
      () => "Under 1%",
    ),
  ],
};

const alertnessSpec: ReadingSpec = {
  label: "Alertness",
  organ: "brain",
  series: "alertness",
  unit: "",
  toValue: percentOf,
  format: (x) => levelWord(x / 100),
  trendEpsilon: 0.005,
  headingChange: 0.03,
  range: () => {
    const r = REFERENCE.alertness;
    return { min: 0, max: 100, typicalLow: r.low, typicalHigh: r.high, typicalLabel: "My estimate of a usual waking day", evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.alertness;
    if (c.asleep) return quiet("Asleep");
    if (s.value > r.high) return EXPECTED;
    return s.value < r.low ? unpainted(LOW) : NORMAL;
  },
  why: [
    [(c) => c.asleep, () => "You are asleep"],
    [(c) => startedBy("stress", 0.2)(c) && !c.training, (c) => `Held up by ${causeOf(c, "stress", 0.2) ?? ""}`],
    [(c, s) => s.value > 80 && c.v("caffeineFelt") >= 0.2, () => "Held up by caffeine"],
    [(c) => alertnessDrains(c) !== null, (c) => alertnessDrains(c) ?? ""],
    [always, () => "You are early in your day"],
  ],
  forecast: [
    (c) => {
      if (c.asleep) return null;
      const horizonEnd = Math.min(c.t + REFERENCE.headingHorizonMin, minutesUntilSleep(c));
      // The same moment the Sleepy feeling names, so the two never disagree by a minute.
      const sleepiest = peakAhead(c, "drowsy", 0.02, FEELING_DISPLAY.peakHorizonMin);
      if (sleepiest && sleepiest.at <= horizonEnd) return near("Lowest", sleepiest.at);
      const low = extremeAhead(c, "alertness", "min");
      if (low.at > c.t + 2 && low.at <= horizonEnd && c.v("alertness") - low.value >= 0.03) return near("Lowest", low.at);
      const high = peakAhead(c, "alertness", 0.03);
      return high && high.at <= horizonEnd ? near("Picks up", high.at) : null;
    },
  ],
};

const alcoholPresent = (s: Sample) => s.raw >= REFERENCE.alcohol.presentAboveGPerL;

const alcoholSpec: ReadingSpec = {
  label: "Alcohol",
  organ: "liver",
  series: "alcohol",
  unit: "g/L",
  toValue: identity,
  format: fixed(2),
  trendEpsilon: 0.003,
  headingChange: 0.02,
  range: () => {
    const r = REFERENCE.alcohol;
    return { min: 0, max: r.scaleMaxGPerL, typicalLow: 0, typicalHigh: r.limitGPerL, typicalLabel: `Crash risk climbs from ${r.riskGPerL} g/L`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => {
    const r = REFERENCE.alcohol;
    if (s.raw >= r.limitGPerL) return HIGH;
    if (s.raw >= r.riskGPerL) return SLIGHTLY_RAISED;
    return alcoholPresent(s) ? EXPECTED : quiet("None");
  },
  why: [
    [(_c, s) => alcoholPresent(s) && s.trend === "rising", () => "It is still crossing from your gut"],
    [(_c, s) => alcoholPresent(s), () => "Your liver is clearing it at a steady rate"],
    [always, () => "No alcohol in your blood"],
  ],
  forecast: [
    peaksAt(0.02, (raw) => `Peaks at ${raw.toFixed(2)}`),
    reaches(
      (_c, s) => alcoholPresent(s),
      (raw) => raw < REFERENCE.alcohol.presentAboveGPerL,
      () => "Clear",
    ),
  ],
};

const bladderSpec: ReadingSpec = {
  label: "Bladder",
  organ: "bladder",
  series: "bladderMl",
  unit: "ml",
  toValue: identity,
  format: tens,
  trendEpsilon: 1,
  headingChange: null,
  range: () => {
    const r = REFERENCE.bladder;
    return { min: 0, max: r.capacityMl, typicalLow: 0, typicalHigh: r.strongDesireMl, typicalLabel: `You notice it near ${r.firstDesireMl} ml, urgent near ${r.strongDesireMl} ml`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.bladder;
    if (c.asleep && s.raw >= r.strongDesireMl) return { ...EXPECTED, word: "Full by morning" };
    return s.raw >= r.firstDesireMl ? quiet("Filling") : NORMAL;
  },
  why: [
    [(c) => c.asleep, () => "Your kidneys fill it while you sleep"],
    [always, () => `Your kidneys add at least ${Math.round(KIDNEY.urineMlPerMin * 60)} ml an hour`],
  ],
  forecast: [
    (c) => {
      const at = nextVoid(c);
      return at === null ? null : near("You'll want to go", at);
    },
  ],
};

// Scales from 0 to 100 that only move when something pushes them.
function eventScaleSpec(label: string, organ: OrganId, series: SeriesName, band: { high: number; evidence: Evidence; source: string }, why: readonly ReasonRow[], judge: (c: Context, s: Sample) => Judgement): ReadingSpec {
  return {
    label,
    organ,
    series,
    unit: "",
    toValue: percentOf,
    format: (x) => levelWord(x / 100),
    trendEpsilon: 0.003,
    headingChange: 0.05,
    range: () => ({ min: 0, max: 100, typicalLow: 0, typicalHigh: band.high, typicalLabel: band.high < 100 ? "Quiet at rest" : "Rises with what you do", evidence: band.evidence, source: band.source }),
    judge,
    why,
    forecast: [reaches((_c, s) => s.value >= 5, (raw) => raw * 100 < 5, () => "Settles")],
  };
}

const isIll = (c: Context) => c.events.some((e) => e.preset === "illness");

const coolingDown = (c: Context) => !c.moving && fromMoving(c, "temperature") >= PROCESS.coolingNamedFromC;

const temperatureSpec: ReadingSpec = {
  label: "Temperature",
  organ: "brain",
  series: "temperature",
  unit: "°C",
  toValue: identity,
  format: fixed(1),
  trendEpsilon: 0.02,
  headingChange: 0.3,
  range: () => {
    const r = REFERENCE.temperature;
    return { ...r.scale, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} °C at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.temperature;
    if (s.value >= r.dangerC) return HIGH;
    if (s.value < r.low) return unpainted(LOW);
    if (s.value <= r.high) return NORMAL;
    if (c.moving || c.exerting || coolingDown(c)) return EXPECTED;
    return s.value >= r.feverC ? { verdict: "raised", word: "Fever", tone: "note" } : unpainted(SLIGHTLY_RAISED);
  },
  why: [
    [(c) => c.training !== null || c.moving, () => "Working muscles make heat"],
    [coolingDown, (c) => `Cooling down after ${movedWord(c)}`],
    [(c) => isIll(c) && startedBy("temperature", 0.2)(c), () => "Your immune system turned up your temperature"],
    causedBy("temperature", 0.2, raises),
    [(c) => fromCycle(c, "temperature") >= CYCLE.namedFrom.warmthC, () => "A little warmer in this part of your cycle"],
    [always, () => "Your usual daily rhythm"],
  ],
  forecast: [
    reaches(
      (_c, s) => s.value > REFERENCE.temperature.high,
      (raw) => raw <= REFERENCE.temperature.high,
      () => `Back under ${REFERENCE.temperature.high}`,
    ),
  ],
};

const stressSpec = eventScaleSpec(
  "Stress",
  "brain",
  "stressLevel",
  REFERENCE.stressLevel,
  [causedBy("stress", 0.02, raises), [always, () => "No stress signal right now"]],
  (c, s) => {
    if (s.value < REFERENCE.stressLevel.high) return NORMAL;
    return c.exerting ? EXPECTED : { verdict: "raised", word: "Raised", tone: "calm" };
  },
);

const inflammationSpec = eventScaleSpec(
  "Inflammation",
  "spleen",
  "inflammation",
  REFERENCE.inflammation,
  [causedBy("inflammation", 0.02, raises), [always, () => "No inflammation signal right now"]],
  (_c, s) => (s.value < REFERENCE.inflammation.high ? NORMAL : EXPECTED),
);

const immuneSpec = eventScaleSpec(
  "Immune response",
  "spleen",
  "immune",
  REFERENCE.immune,
  [causedBy("immune", 0.02, (cause) => `Working against ${cause}`), [always, () => "Patrolling as usual"]],
  (_c, s) => (s.value < REFERENCE.immune.high ? NORMAL : EXPECTED),
);

const PHASE_WORD: Record<CyclePhase, string> = { period: "Period", follicular: "Follicular phase", ovulation: "Around ovulation", luteal: "Luteal phase" };
const phaseOf = (c: Context): CyclePhase | null => (c.tr.cycle ? cyclePhase(c.tr.cycle, c.t) : null);

const PHASE_SAYS: Record<CyclePhase, { day: string; estradiol: string; progesterone: string }> = {
  period: { day: "The lining of the uterus is shedding", estradiol: "Low, and starting to rise as a follicle grows", progesterone: "Low, which is what started the period" },
  follicular: { day: "An egg is ripening and the lining is rebuilding", estradiol: "Rising, because a follicle in the ovary is growing", progesterone: "Low until an egg is released" },
  ovulation: { day: "A surge of LH releases an egg about now", estradiol: "At its peak, which triggers the LH surge", progesterone: "Just starting to rise" },
  luteal: { day: "The lining stays ready, and your body runs slightly warmer", estradiol: "A second, smaller rise from the empty follicle", progesterone: "High, made by the empty follicle" },
};

const nextPeriod = (c: Context): Said | null => {
  if (!c.tr.cycle) return null;
  const days = Math.round(minutesToNextPeriod(c.tr.cycle, c.t) / 1440);
  const text = days <= 1 ? "Next period about tomorrow" : `Next period in about ${days} days`;
  return { text, short: `Period in ${days} d`, at: null };
};

const cycleDaySpec: ReadingSpec = {
  label: "Cycle day",
  organ: "uterus",
  series: "cycleDay",
  unit: "day",
  toValue: identity,
  format: rounded,
  trendEpsilon: 2,
  headingChange: null,
  range: (c) => {
    const length = c.tr.cycle?.lengthDays ?? CYCLE.lengthDays;
    return { min: 1, max: length, typicalLow: 1, typicalHigh: length, typicalLabel: `Of a ${length}-day cycle`, evidence: CYCLE.evidence, source: CYCLE.source };
  },
  judge: (c) => quiet(PHASE_WORD[phaseOf(c) ?? "follicular"]),
  why: [[always, (c) => PHASE_SAYS[phaseOf(c) ?? "follicular"].day]],
  forecast: [(c) => nextPeriod(c)],
};

const hormoneSpec = (label: string, organ: OrganId, series: "estradiol" | "progesterone", unit: string, digits: number, says: "estradiol" | "progesterone"): ReadingSpec => ({
  label,
  organ,
  series,
  unit,
  toValue: identity,
  format: (x) => x.toFixed(digits),
  trendEpsilon: series === "estradiol" ? 2 : 0.05,
  headingChange: null,
  range: () => {
    const r = CYCLE.scale[says];
    return { min: r.min, max: r.max, typicalLow: r.low, typicalHigh: r.high, typicalLabel: `${r.low} to ${r.high} ${unit} across a cycle`, evidence: CYCLE.evidence, source: CYCLE.source };
  },
  judge: (c) => quiet(PHASE_WORD[phaseOf(c) ?? "follicular"]),
  why: [[always, (c) => PHASE_SAYS[phaseOf(c) ?? "follicular"][says]]],
  forecast: [],
});

const estradiolSpec = hormoneSpec("Estrogen", "ovaries", "estradiol", "pmol/L", 0, "estradiol");
const progesteroneSpec = hormoneSpec("Progesterone", "ovaries", "progesterone", "nmol/L", 1, "progesterone");

const rewardSpec = eventScaleSpec("Feel-good chemicals", "brain", "reward", REFERENCE.reward, [causedBy("reward", 0.02, raises), [always, () => "At their usual level"]], () => NORMAL);

const fluidLitresPerPercent = (c: Context, share: number) => (c.tr.scenario.body.weightKg * share * 1000) / 1000;
const fluidLost = (s: Sample) => s.value < -0.05;

const fluidSpec: ReadingSpec = {
  label: "Fluid",
  organ: "kidneys",
  series: "fluidBalance",
  unit: "L",
  toValue: (raw) => raw / 1000,
  format: (x) => (x <= -0.05 ? `−${Math.abs(x).toFixed(1)}` : "0.0"),
  trendEpsilon: 2,
  headingChange: 100,
  range: (c) => {
    const r = REFERENCE.fluid;
    const typicalLow = -fluidLitresPerPercent(c, r.noticeableShareOfWeight);
    return { min: -fluidLitresPerPercent(c, r.impairingShareOfWeight * 2), max: 0.2, typicalLow, typicalHigh: 0.1, typicalLabel: `Within ${Math.abs(typicalLow).toFixed(1)} L of even`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.fluid;
    if (s.value <= -fluidLitresPerPercent(c, r.impairingShareOfWeight)) return { ...LOW, word: "Dry" };
    return s.value <= -fluidLitresPerPercent(c, r.noticeableShareOfWeight) ? { ...unpainted(LOW), word: "A little dry" } : NORMAL;
  },
  why: [
    [(c) => c.moving || c.training !== null, () => "Lost through sweat and breath"],
    causedBy("fluidLoss", 0.5, (cause) => `Lost to ${cause}`),
    [(_c, s) => fluidLost(s), () => "You haven't drunk it back yet"],
    [always, () => "Nothing extra lost"],
  ],
  forecast: [],
};

const pressureCauses = (c: Context) => topCause(c, "bloodPressure", 3);

const bloodPressureSpec: ReadingSpec = {
  label: "Blood pressure",
  organ: "heart",
  series: "systolic",
  unit: "mmHg",
  toValue: identity,
  format: rounded,
  trendEpsilon: 0.5,
  headingChange: 5,
  range: () => {
    const r = REFERENCE.bloodPressure;
    return { ...r.scale, typicalLow: r.typicalLow, typicalHigh: r.high, typicalLabel: `Under ${r.high} mmHg at rest`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.bloodPressure;
    if (c.exerting || c.moving || fromMoving(c, "bloodPressure") >= PROCESS.movingNamedFromMmHg) return EXPECTED;
    if (s.value >= r.danger) return HIGH;
    if (s.value >= r.raised) return { verdict: "raised", word: "Raised", tone: "note" };
    return s.value >= r.high ? unpainted(SLIGHTLY_RAISED) : NORMAL;
  },
  why: [
    [(c) => fromMoving(c, "bloodPressure") >= PROCESS.movingNamedFromMmHg, (c) => `About ${Math.round(fromMoving(c, "bloodPressure"))} mmHg from ${movedWord(c)}`],
    [(c) => pressureCauses(c) !== null, (c, s) => `About ${Math.round(s.raw - RESTING_SYSTOLIC_MMHG)} mmHg from ${pressureCauses(c)?.causeName ?? ""}`],
    [always, () => "My estimate of your resting pressure"],
  ],
  forecast: [],
};

const READINGS: Record<TableReadingId, ReadingSpec> = {
  glucose: glucoseSpec,
  insulin: insulinSpec,
  tg: triglycerideSpec,
  hr: heartSpec,
  output: outputSpec,
  breaths: breathingSpec,
  flowGut: gutShareSpec,
  flowMuscle: bloodShareSpec("flowMuscle", "Blood to muscle", "muscle", REFERENCE.bloodFlow.muscle, [
    [(c) => c.moving, (c) => `${POSTURE_WORD[c.posture]} sends more blood to your legs`],
    [always, () => "Resting muscle needs little blood"],
  ]),
  flowBrain: bloodShareSpec("flowBrain", "Blood to brain", "brain", REFERENCE.bloodFlow.brain, [[always, (c, s) => `Your brain keeps a steady ${flowLitres(c, s)} L a minute`]]),
  flowKidneys: bloodShareSpec("flowKidneys", "Blood to kidneys", "kidneys", REFERENCE.bloodFlow.kidneys, [[always, (c, s) => `Your kidneys receive ${flowLitres(c, s)} L a minute`]]),
  stomach: stomachSpec,
  absorbing: absorbingSpec,
  glycogen: glycogenSpec,
  muscleUptake: muscleUptakeSpec,
  burn: burnSpec,
  fuel: fuelSpec,
  caffeine: caffeineSpec,
  receptors: receptorsSpec,
  alertness: alertnessSpec,
  alcohol: alcoholSpec,
  bladder: bladderSpec,
  bloodPressure: bloodPressureSpec,
  temperature: temperatureSpec,
  stressLevel: stressSpec,
  inflammation: inflammationSpec,
  immune: immuneSpec,
  reward: rewardSpec,
  fluid: fluidSpec,
  cycleDay: cycleDaySpec,
  estradiol: estradiolSpec,
  progesterone: progesteroneSpec,
};

// A fever comes first, so it leads the notable list when it ties with something else.
const READING_ORDER: TableReadingId[] = ["temperature", "glucose", "insulin", "tg", "hr", "output", "bloodPressure", "breaths", "flowGut", "flowMuscle", "flowBrain", "flowKidneys", "stomach", "absorbing", "glycogen", "muscleUptake", "burn", "fuel", "caffeine", "receptors", "alertness", "stressLevel", "reward", "inflammation", "immune", "alcohol", "bladder", "fluid", "cycleDay", "estradiol", "progesterone"];

function firstReason(rows: readonly ReasonRow[], c: Context, s: Sample): string {
  for (const [test, text] of rows) if (test(c, s)) return text(c, s);
  throw new Error("A reason table must end with a row that always passes");
}

function buildReading(id: TableReadingId, c: Context): Reading {
  const spec = READINGS[id];
  const raw = c.v(spec.series);
  const sample: Sample = { raw, value: spec.toValue(raw, c), trend: trendOf(c, spec) };
  const { evidence, source, ...scale } = spec.range(c);
  const judged = spec.judge(c, sample);
  let said: Said | null = null;
  for (const rule of spec.forecast) {
    said = rule(c, sample, spec.series);
    if (said !== null) break;
  }
  return {
    id,
    label: spec.label,
    organ: spec.organ,
    value: sample.value,
    display: spec.format(sample.value),
    unit: spec.unit,
    trend: sample.trend,
    scale,
    heading: headingOf(c, spec),
    verdict: judged.verdict,
    verdictWord: judged.word,
    tone: judged.tone,
    why: firstReason(spec.why, c, sample),
    forecast: said?.text ?? null,
    forecastAt: said?.at ?? null,
    forecastShort: said?.short ?? null,
    evidence,
    source,
    series: spec.series,
  };
}

// A bare number means nothing, so its unit sits quietly beside it. Only what the row's name already
// says is shortened ("% of blood" beside "Blood to gut") or left out (°C beside "Temperature").
export function shortUnit(unit: string) {
  if (unit === "°C" || unit === "day") return "";
  if (unit.startsWith("%")) return "%";
  if (unit === "a minute") return "/min";
  return unit;
}

const isTableReading = (id: ReadingId): id is TableReadingId => id in READINGS;

// One reading at any minute, in the units and words the screen uses for it.
export function readingCurve(tr: Trajectory, id: ReadingId, now: number): { valueAt: (minute: number) => number; textAt: (minute: number) => string } | null {
  if (!isTableReading(id)) return null;
  const spec = READINGS[id];
  const c = contextAt(tr, now);
  const series = tr.series[spec.series];
  const valueAt = (minute: number) => spec.toValue(series[Math.max(0, Math.min(series.length - 1, Math.round(minute)))], c);
  const unit = shortUnit(spec.unit);
  return {
    valueAt,
    textAt: (minute) => {
      const text = spec.format(valueAt(minute));
      if (!/\d/.test(text) || !unit) return text;
      return unit === "%" ? `${text}%` : `${text} ${unit}`;
    },
  };
}

function intensityWord(now: number, later: number): string {
  const d = FEELING_DISPLAY;
  if (now >= d.strongFrom) return "Strong";
  if (later - now >= d.changeShownAbove) return "Building";
  if (now - later >= d.changeShownAbove) return "Fading";
  if (now >= d.moderateFrom) return "Moderate";
  return now >= d.mildFrom ? "Mild" : "Faint";
}

// Food logged within a few minutes of another counts as one sitting.
function sittingKcal(c: Context, meal: Intake): number {
  return c.eaten.filter((i) => Math.abs(i.at - meal.at) <= 15).reduce((sum, i) => sum + foodKcalOf(i), 0);
}

// The meal doing the most to make you drowsy now, which is often an earlier one than the last.
function heaviestMeal(c: Context): Intake | null {
  const dipOf = (i: Intake) => mealDipOf(kcalOf(i), c.t - i.at);
  const meals = c.eaten.filter((i) => dipOf(i) > 0);
  return meals.length ? meals.reduce((best, next) => (dipOf(next) > dipOf(best) ? next : best)) : null;
}

const mealDrowsiness = (c: Context) => drowsyFromMeal(c.v("mealDip"), c.v("caffeineFelt"));

// What is making you sleepy, biggest first. A new cause of drowsiness is a new row.
const SLEEPY_CAUSES: { size: (c: Context) => number; text: (c: Context) => string }[] = [
  {
    size: mealDrowsiness,
    text: (c) => {
      const meal = heaviestMeal(c);
      return meal ? `You ate ${Math.round(sittingKcal(c, meal))} kcal at ${clock(meal.at)}` : "You ate recently";
    },
  },
  { size: (c) => drowsyFromSleepPressure(c.v("sleepPressure")), text: (c) => `You have been awake ${hoursWord(hoursAwake(c))}` },
  { size: (c) => c.tr.channels.drowsiness[nearestMinute(c)], text: (c) => `From ${causeOf(c, "drowsiness", 0) ?? ""}` },
  { size: (c) => c.v("drowsy") - mealDrowsiness(c) - drowsyFromSleepPressure(c.v("sleepPressure")) - c.tr.channels.drowsiness[nearestMinute(c)], text: () => "Your body clock dips in the afternoon" },
];

const minutesUntilSleep = (c: Context) => firstWhen(c, (m) => POSTURES[Math.round(c.tr.series.posture[m])] === "sleeping") ?? DAY.minutes;

interface FeelingSpec {
  id: string;
  label: string;
  organ: OrganId;
  level: (c: Context, at: number) => number; // 0 to 1, read from the model's scales
  cause: (c: Context) => string;
  when: (c: Context, level: (at: number) => number) => string | null;
}

const fadesBelowNegligible =
  (word: string) =>
  (c: Context, level: (at: number) => number): string | null => {
    const at = firstWhen(c, (m) => level(m) < FEELING_DISPLAY.negligibleBelow);
    return at === null ? null : `${word} near ${clock(at)}`;
  };

const warmth = (share: number) => clamp01((share - FEELING_DISPLAY.warmFlowFrom) / (FEELING_DISPLAY.warmFlowFull - FEELING_DISPLAY.warmFlowFrom)) * FEELING_DISPLAY.warmMax;
const alertAboveBaseline = (x: number) => clamp01((x - FEELING_DISPLAY.alertAbove) / (1 - FEELING_DISPLAY.alertAbove));
const startedMuscleEvents = (c: Context) => c.tr.muscleEvents.filter((e) => e.from <= c.t);
const mostSore = (c: Context, at: number) => MUSCLE_GROUPS.reduce((most, group) => Math.max(most, muscleStateAt(c.tr.muscleEvents, group, at).soreness), 0);
const sessionEnd = (e: BodyEvent) => endOf(e) ?? e.from;

function sorenessPeak(c: Context): string | null {
  const ends = startedMuscleEvents(c).map(sessionEnd);
  if (!ends.length) return null;
  const peak = Math.max(...ends) + MUSCLE_RECOVERY.sorenessPeakH * 60;
  return peak > c.t ? `Peaks ${whenWords(peak, c.t)}` : null;
}

// Feelings the model's own scales produce. Feelings an event brings are merged in by feelingsOf.
const FEELINGS: FeelingSpec[] = [
  {
    id: "cramps",
    label: "Cramps",
    organ: "uterus",
    level: (c, at) => (c.tr.cycle ? crampLevel(c.tr.cycle, at) : 0),
    cause: (c) => `Day ${Math.round(c.v("cycleDay"))} of your period`,
    when: () => null,
  },
  {
    id: "full",
    label: "Full",
    organ: "stomach",
    level: (c, at) => c.v("fullness", at),
    cause: (c) => `Your stomach holds ${tens(c.v("stomachMl"))} ml`,
    when: fadesBelowNegligible("Fades"),
  },
  {
    id: "warm",
    label: "Warm",
    organ: "small_intestine",
    level: (c, at) => warmth(c.v("flowGut", at)),
    cause: (c) => `Digesting makes heat, ${Math.round(c.v("flowGut") * 100)}% of blood at your gut`,
    when: fadesBelowNegligible("Fades"),
  },
  {
    id: "hot",
    label: "Hot",
    organ: "muscle",
    level: (c, at) => fromMoving(c, "temperature", at) / ACTIVITY.temperatureC.running,
    cause: () => "Your working muscles make heat",
    when: fadesBelowNegligible("Fades"),
  },
  {
    id: "breathless",
    label: "Out of breath",
    organ: "lungs",
    level: (c, at) => fromMoving(c, "breathing", at) / ACTIVITY.breaths.running,
    cause: (c) => `You are breathing ${Math.round(c.v("breaths"))} times a minute`,
    when: fadesBelowNegligible("Eases"),
  },
  {
    id: "sleepy",
    label: "Sleepy",
    organ: "brain",
    level: (c, at) => c.v("drowsy", at),
    cause: (c) => [...SLEEPY_CAUSES].sort((a, b) => b.size(c) - a.size(c))[0].text(c),
    when: (c) => {
      const peak = peakAhead(c, "drowsy", 0.02, FEELING_DISPLAY.peakHorizonMin);
      return peak && peak.at <= Math.min(c.t + FEELING_DISPLAY.peakHorizonMin, minutesUntilSleep(c)) ? `Peaks around ${clock(peak.at)}` : null;
    },
  },
  {
    id: "alert",
    label: "Alert",
    organ: "brain",
    level: (c, at) => alertAboveBaseline(c.v("alertness", at)),
    cause: (c) => (c.v("caffeineFelt") >= PROCESS.caffeineWorkingAboveFelt ? "Caffeine is masking your tiredness" : hoursAwake(c) < FEELING_DISPLAY.earlyInDayH ? "You are early in your day" : "Your body clock is at a high point"),
    when: fadesBelowNegligible("Fades"),
  },
  {
    id: "jittery",
    label: "Jittery",
    organ: "brain",
    level: (c, at) => c.v("jitter", at),
    cause: (c) => `Lots of caffeine, ${c.v("caffeine").toFixed(1)} mg/L in your blood`,
    when: fadesBelowNegligible("Eases"),
  },
  {
    id: "hungry",
    label: "Hungry",
    organ: "stomach",
    level: (c, at) => c.v("hunger", at),
    cause: (c) => (c.lastFood ? `Your last food was ${hoursWord((c.t - c.lastFood.at) / 60)} ago` : "You have logged no food today"),
    when: () => null,
  },
  {
    id: "low",
    label: "Low energy",
    organ: "liver",
    level: (c, at) => c.v("crash", at),
    cause: (c) => `Blood sugar has dipped to ${toMmol(c.v("glucose")).toFixed(1)} mmol/L`,
    when: fadesBelowNegligible("Recovers"),
  },
  {
    id: "sore",
    label: "Sore",
    organ: "muscle",
    level: mostSore,
    cause: (c) => {
      const named = namesOf(groupsWhere(c, (s) => s.soreness >= REFERENCE.muscleState.soreFrom));
      return named ? `You worked your ${named}` : "You worked hard recently";
    },
    when: sorenessPeak,
  },
  {
    id: "thirsty",
    label: "Thirsty",
    organ: "kidneys",
    level: (c, at) => clamp01(-c.v("fluidBalance", at) / (c.tr.scenario.body.weightKg * REFERENCE.fluid.impairingShareOfWeight * 1000)),
    cause: (c) => `You have lost about ${(-c.v("fluidBalance") / 1000).toFixed(1)} L of fluid`,
    when: () => null,
  },
];

function eventFeelingsOf(c: Context): Feeling[] {
  const d = FEELING_DISPLAY;
  const out: Feeling[] = [];
  for (const event of c.events) {
    for (const f of event.feelings) {
      const at = (minute: number) => f.amount * curveStrength(f, event.from, event.ends, minute);
      const now = clamp01(at(c.t));
      if (now < d.negligibleBelow) continue;
      let fades: number | null = null;
      if (event.ends !== null) {
        const remaining = Math.max(0, Math.log2(now / d.negligibleBelow) * f.halfLifeMin);
        fades = Math.max(c.t, event.ends) + remaining;
      }
      out.push({ byClaude: event.preset === "custom", id: f.id, label: f.label, intensity: now, word: intensityWord(now, at(c.t + d.changeWindowMin)), cause: f.cause, when: fades === null ? null : `Fades ${whenWords(fades, c.t)}`, organ: f.organ });
    }
  }
  return out;
}

function feelingsOf(c: Context): Feeling[] {
  if (c.asleep) return [];
  const d = FEELING_DISPLAY;
  const strongest = new Map<string, Feeling>();
  const offer = (feeling: Feeling) => {
    const known = strongest.get(feeling.id);
    if (!known || feeling.intensity > known.intensity) strongest.set(feeling.id, feeling);
  };
  for (const spec of FEELINGS) {
    const level = (at: number) => spec.level(c, at);
    const now = clamp01(level(c.t));
    if (now >= d.negligibleBelow) offer({ id: spec.id, label: spec.label, intensity: now, word: intensityWord(now, level(c.t + d.changeWindowMin)), cause: spec.cause(c), when: spec.when(c, level), organ: spec.organ });
  }
  const logged = eventFeelingsOf(c);
  for (const feeling of logged) offer(feeling);
  // What you told it about comes before what it worked out by itself, such as thirst.
  const rank = (feeling: Feeling) => feeling.intensity + (logged.some((f) => f.id === feeling.id) ? d.loggedOutranksBy : 0);
  return [...strongest.values()].sort((a, b) => rank(b) - rank(a)).slice(0, d.mostShown);
}

// The status table for muscle groups, first passing row wins.
const MUSCLE_STATUS: readonly [test: (s: MuscleState) => boolean, word: string][] = [
  [(s) => s.work >= REFERENCE.muscleState.workingFrom, "Working"],
  [(s) => s.soreness >= REFERENCE.muscleState.soreFrom, "Sore"],
  [(s) => s.fatigue >= REFERENCE.muscleState.tiredFrom, "Tired"],
  [(s) => s.repair >= REFERENCE.muscleState.repairingFrom, "Repairing"],
];

const RESTED = "Rested";
const muscleWord = (s: MuscleState) => MUSCLE_STATUS.find(([test]) => test(s))?.[1] ?? RESTED;
const muscleLevel = (s: MuscleState) => Math.max(s.work, s.fatigue, s.soreness, s.repair);

// The minute a muscle stops being noticeably different from rested.
export function normalAgainAt(tr: Trajectory, group: MuscleGroup, t: number): number | null {
  const r = REFERENCE.muscleState;
  for (let h = 1; h <= r.normalWithinDays * 24; h++) {
    const later = muscleStateAt(tr.muscleEvents, group, t + h * 60);
    if (later.work < r.workingFrom && later.soreness < r.soreFrom && later.fatigue < r.tiredFrom) return t + h * 60;
  }
  return null;
}

function sorenessLineFor(c: Context, group: MuscleGroup): string | null {
  const worked = startedMuscleEvents(c).filter((e) => e.muscles.some((m) => m.group === group));
  if (!worked.length) return null;
  const peak = Math.max(...worked.map(sessionEnd)) + MUSCLE_RECOVERY.sorenessPeakH * 60;
  return peak > c.t ? `Soreness peaks ${whenWords(peak, c.t)}` : null;
}

function muscleSummaries(c: Context): MuscleSummary[] {
  return MUSCLE_GROUPS.map((group) => {
    const state = muscleStateAt(c.tr.muscleEvents, group, c.t);
    const status = muscleWord(state);
    const rested = status === RESTED;
    const normalAt = rested ? null : normalAgainAt(c.tr, group, c.t);
    return {
      ...state,
      group,
      label: MUSCLE_LABEL[group],
      status,
      level: muscleLevel(state),
      sorenessLine: rested ? null : sorenessLineFor(c, group),
      normalLine: normalAt === null ? null : `Should feel normal ${whenWords(normalAt, c.t)}`,
    };
  });
}

function muscleReading(summary: MuscleSummary, c: Context): Reading {
  const r = REFERENCE.muscleState;
  const change = muscleLevel(muscleStateAt(c.tr.muscleEvents, summary.group, c.t + 30)) - muscleLevel(muscleStateAt(c.tr.muscleEvents, summary.group, c.t - 30));
  const worked = startedMuscleEvents(c).filter((e) => e.muscles.some((m) => m.group === summary.group));
  const last = worked.length ? worked[worked.length - 1] : null;
  const rested = summary.status === RESTED;
  const peakAt = last ? sessionEnd(last) + MUSCLE_RECOVERY.sorenessPeakH * 60 : null;
  const tone: Tone = summary.soreness >= r.verySoreFrom ? "note" : "calm";
  const why: Record<string, string> = {
    Working: "Working now, burning stored sugar",
    Sore: "Tiny damage from the session is healing",
    Tired: "Fatigue from the session",
    Repairing: "Building protein faster than usual",
    [RESTED]: "Nothing logged for this muscle lately",
  };
  return {
    id: `muscle:${summary.group}`,
    label: summary.label,
    organ: "muscle",
    value: summary.level * 100,
    display: summary.status,
    unit: "",
    trend: change > 0.01 ? "rising" : change < -0.01 ? "falling" : "steady",
    scale: { min: 0, max: 100, typicalLow: 0, typicalHigh: 100, typicalLabel: "Fully rested at the left" },
    heading: peakAt !== null && peakAt > c.t ? muscleStateAt(c.tr.muscleEvents, summary.group, peakAt).soreness * 100 : null,
    verdict: rested ? "normal" : "expected",
    verdictWord: summary.status,
    tone,
    why: why[summary.status],
    forecast: summary.sorenessLine ?? summary.normalLine,
    forecastAt: null,
    forecastShort: null,
    evidence: r.evidence,
    source: r.source,
    series: null,
  };
}

const TONE_RANK: Record<Tone, number> = { calm: 0, note: 1, concern: 2 };

function worstTone(tones: Tone[]): Tone {
  return tones.reduce<Tone>((worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst), "calm");
}

type WordRow = readonly [test: (c: Context, reading: (id: ReadingId) => Reading) => boolean, word: string | ((c: Context) => string)];

interface SystemSpec {
  words: readonly WordRow[]; // first passing row wins; the last row always passes and means quiet
  level: (c: Context, reading: (id: ReadingId) => Reading) => number;
  sentence: (c: Context, reading: (id: ReadingId) => Reading) => string; // under 14 words, about this system only
}

function activeSubstance(c: Context) {
  const minute = Math.max(0, Math.min(DAY.minutes, Math.floor(c.t)));
  return [...c.tr.substances.values()].find(({ substance, series }) => substance.at <= c.t && series[minute] > 0.01);
}

const OVERVIEW_WORDS: readonly WordRow[] = [
  [(c) => c.asleep, "Asleep"],
  [(c) => c.training !== null, "Training"],
  [(c) => c.moving, (c) => POSTURE_WORD[c.posture]],
  [(c) => c.v("digestion") >= 0.04, "Digesting"],
  [(c) => c.events.some((e) => e.preset === "illness" && e.ends === null), "Unwell"],
  [always, "Resting"],
];

// The groups in a given state right now, however many sessions put them there, busiest first.
const groupsWhere = (c: Context, test: (s: MuscleState) => boolean): MuscleWork[] =>
  MUSCLE_GROUPS.flatMap((group) => {
    const state = muscleStateAt(c.tr.muscleEvents, group, c.t);
    return test(state) ? [{ group, load: muscleLevel(state) }] : [];
  });

const anyMuscle = (c: Context, test: (s: MuscleState) => boolean) => MUSCLE_GROUPS.some((group) => test(muscleStateAt(c.tr.muscleEvents, group, c.t)));
const hasFever = (c: Context) => c.v("temperature") >= REFERENCE.temperature.feverC && !c.moving && c.training === null;
const fighting = (c: Context) => c.events.find((e) => e.ends === null && effectAt(e, "immune", c.t) >= REFERENCE.immune.high / 100) ?? null;
// A hard session raises stress hormones too, and nobody would call that being stressed.
const stressedNow = (c: Context) => c.v("stressLevel") >= REFERENCE.stressLevel.high / 100 && !c.exerting;
const lowFuel = (c: Context) => c.v("liverGlycogen") < REFERENCE.liverGlycogen.low;
const isDry = (c: Context) => c.v("fluidBalance") <= -c.tr.scenario.body.weightKg * REFERENCE.fluid.noticeableShareOfWeight * 1000;
const mmolText = (c: Context) => toMmol(c.v("glucose")).toFixed(1);

function digestionSentence(c: Context): string {
  const empties = stateForecast(c.tr, c.t).stomachEmpty;
  if (c.v("stomachKcal") > REFERENCE.stillDigestingKcal) return `Your stomach holds ${tens(c.v("stomachMl"))} ml${empties === null ? "" : ` and empties near ${clock(empties)}`}.`;
  if (c.v("digestion") >= 0.04) return "Your intestine is absorbing the last of the meal.";
  return c.v("stomachMl") > STOMACH.restingVolumeMl + REFERENCE.stomach.emptyAboveRestingMl ? "Liquid is passing through your stomach." : "Your stomach and gut are resting.";
}

function energySentence(c: Context, r: (id: ReadingId) => Reading): string {
  const peak = peakAhead(c, "glucose", 2);
  if (lowFuel(c)) return `Liver fuel is low at ${Math.round(c.v("liverGlycogen"))} g, and blood sugar is ${mmolText(c)}.`;
  if (r("glucose").trend === "rising") return peak ? `Blood sugar is ${mmolText(c)} and rising, peaking at ${toMmol(peak.value).toFixed(1)} near ${clock(peak.at)}.` : `Blood sugar is ${mmolText(c)} and rising.`;
  if (r("glucose").trend === "falling") return `Blood sugar is ${mmolText(c)} and coming down.`;
  if (c.v("tg") - c.tr.anthro.baselineTg >= REFERENCE.triglycerides.arrivedAboveRestMgDl) return `Blood fat is ${Math.round(c.v("tg"))} mg/dL and clearing.`;
  return `Blood sugar is steady at ${mmolText(c)}.`;
}

function heartSentence(c: Context): string {
  const bpm = Math.round(c.v("hr"));
  const breaths = Math.round(c.v("breaths"));
  if (c.moving || c.exerting) return `Your heart is at ${bpm} bpm and you breathe ${breaths} times a minute.`;
  const [first] = heartCauses(c);
  if (first && first.bpm >= REFERENCE.heart.raisedAboveOwnRestBpm) return `Your heart is at ${bpm} bpm; ${first.name} adds about ${Math.round(first.bpm)}.`;
  return c.asleep ? `Your heart has slowed to ${bpm} bpm for sleep.` : "Your heart and breathing are at their usual resting pace.";
}

// "Your chest is" and "your quads are": only these two groups read as singular.
const yourMuscles = (groups: MuscleWork[]) => `Your ${namesOf(groups)} ${groups.length === 1 && (groups[0].group === "chest" || groups[0].group === "back") ? "is" : "are"}`;

function muscleSentence(c: Context): string {
  const r = REFERENCE.muscleState;
  const peak = sorenessPeak(c);
  const working = groupsWhere(c, (s) => s.work >= r.workingFrom);
  if (working.length) return `${yourMuscles(working)} working.`;
  const sore = groupsWhere(c, (s) => s.soreness >= r.soreFrom);
  if (sore.length) return peak ? `${yourMuscles(sore)} sore. Soreness ${peak.toLowerCase()}.` : `${yourMuscles(sore)} sore, and it is easing.`;
  const repairing = groupsWhere(c, (s) => s.fatigue >= r.tiredFrom || s.repair >= r.repairingFrom);
  if (repairing.length) return peak ? `${yourMuscles(repairing)} repairing. Soreness ${peak.toLowerCase()}.` : `${yourMuscles(repairing)} repairing.`;
  return "Your muscles are rested.";
}

function brainSentence(c: Context, r: (id: ReadingId) => Reading): string {
  if (c.asleep) return "You are asleep, and sleep is clearing the day's tiredness.";
  if (c.v("jitter") >= FEELING_DISPLAY.negligibleBelow) return "Lots of caffeine, so you may feel jittery.";
  if (c.v("alcohol") >= 0.1) return `Alcohol is slowing your brain, ${c.v("alcohol").toFixed(2)} g/L in your blood.`;
  if (stressedNow(c)) return "Stress hormones are keeping your brain on alert.";
  if (c.v("reward") >= PROCESS.liftedFrom) return "Feel-good chemicals are up.";
  const sleepiest = peakAhead(c, "drowsy", 0.02, FEELING_DISPLAY.peakHorizonMin);
  if (c.v("drowsy") >= PROCESS.sleepyNamedFrom) return sleepiest && sleepiest.at <= minutesUntilSleep(c) ? `You may feel sleepy, most near ${clock(sleepiest.at)}.` : "You may feel sleepy.";
  const blocked = Math.round(c.v("occupancy") * 100);
  if (c.v("caffeineFelt") >= PROCESS.caffeineWorkingAboveFelt) return `Caffeine is ${r("caffeine").trend === "rising" ? "kicking in" : "fading"}, with ${blocked}% of the tired signal blocked.`;
  return "Your brain is clear, with no caffeine at work.";
}

function immuneSentence(c: Context): string {
  const illness = fighting(c);
  if (illness) {
    const day = Math.floor((c.t - illness.from) / 1440) + 1;
    const site = illness.stops[0];
    const where = site && site.organ !== "spleen" ? `, in your ${site.label.toLowerCase()}` : "";
    return `${illness.label}, day ${day}${where}${hasFever(c) ? `, temperature ${c.v("temperature").toFixed(1)}` : ""}.`;
  }
  return c.v("immune") >= REFERENCE.immune.high / 100 ? "Your immune system is winding down." : "Nothing to fight right now.";
}

function clearingSentence(c: Context): string {
  if (c.v("alcohol") >= 0.02) return `Your liver is clearing alcohol, ${c.v("alcohol").toFixed(2)} g/L left.`;
  if (isDry(c)) return `You are a little dry, down about ${(-c.v("fluidBalance") / 1000).toFixed(1)} L.`;
  if (c.v("caffeine") >= PROCESS.clearingActiveAboveMgL) return `Your liver is clearing caffeine, ${c.v("caffeine").toFixed(2)} mg/L left.`;
  const substance = activeSubstance(c);
  if (substance) return `Your body is clearing ${inSentence(substance.substance.label)}.`;
  return c.v("bladderMl") >= REFERENCE.bladder.firstDesireMl ? `Your bladder is filling, about ${tens(c.v("bladderMl"))} ml.` : "Your liver and kidneys are ticking over.";
}

const SYSTEM_STATUS: Record<Exclude<SystemId, "overview">, SystemSpec> = {
  digestion: {
    words: [
      [(c) => c.v("digestion") >= 0.66, "Working hard"],
      [(c) => c.v("digestion") >= 0.25 || c.v("stomachKcal") > REFERENCE.stillDigestingKcal, "Working"],
      [(c) => c.v("digestion") >= 0.04, "Finishing"],
      [always, "Quiet"],
    ],
    level: (c) => c.v("digestion"),
    sentence: digestionSentence,
  },
  energy: {
    words: [
      [(_c, r) => r("glucose").verdict === "low", "Sugar low"],
      [(c) => lowFuel(c), "Liver fuel low"],
      [(_c, r) => r("glucose").trend === "rising", "Rising"],
      [(_c, r) => r("glucose").trend === "falling", "Falling"],
      [(c) => c.v("tg") - c.tr.anthro.baselineTg >= REFERENCE.triglycerides.arrivedAboveRestMgDl, "Clearing fat"],
      [always, "Steady"],
    ],
    level: (c, r) => Math.max((r("insulin").value - 1) / 5, (c.v("tg") - c.tr.anthro.baselineTg) / LIPID.baselineMgDl, c.v("muscleUptakeGMin") / 0.7),
    sentence: energySentence,
  },
  circulation: {
    words: [
      [(c) => c.moving || c.exerting, "Working"],
      [(_c, r) => r("hr").verdict === "high", "Heart high"],
      [(c) => c.v("systolic") >= REFERENCE.bloodPressure.raised, "Pressure up"],
      [(c) => !c.moving && fromMoving(c, "heartRate") >= REFERENCE.heart.raisedAboveOwnRestBpm, "Recovering"],
      [(c, r) => r("hr").verdict === "raised" || eventHeartBpm(c) >= REFERENCE.heart.raisedAboveOwnRestBpm, "Raised"],
      [always, "Steady"],
    ],
    level: (c) => (c.v("hr") - ownRestBpm(c, "sitting")) / 40,
    sentence: heartSentence,
  },
  muscles: {
    words: [
      [(c) => anyMuscle(c, (s) => s.work >= REFERENCE.muscleState.workingFrom), "Working"],
      [(c) => anyMuscle(c, (s) => s.soreness >= REFERENCE.muscleState.soreFrom), "Sore"],
      [(c) => anyMuscle(c, (s) => s.fatigue >= REFERENCE.muscleState.tiredFrom), "Tired"],
      [(c) => anyMuscle(c, (s) => s.repair >= REFERENCE.muscleState.repairingFrom), "Repairing"],
      [always, "Quiet"],
    ],
    level: (c) => MUSCLE_GROUPS.reduce((most, group) => Math.max(most, muscleLevel(muscleStateAt(c.tr.muscleEvents, group, c.t))), 0),
    sentence: muscleSentence,
  },
  brain: {
    words: [
      [(c) => c.asleep, "Asleep"],
      [(c) => c.v("jitter") >= FEELING_DISPLAY.negligibleBelow, "Jittery"],
      [(c) => c.v("alcohol") >= 0.1, "Alcohol"],
      [stressedNow, "Stressed"],
      [(c) => c.v("drowsy") >= PROCESS.sleepyNamedFrom, "Drowsy"],
      [(c) => c.v("reward") >= PROCESS.liftedFrom, "Lifted"],
      [(c, r) => c.v("caffeineFelt") >= PROCESS.caffeineWorkingAboveFelt && r("caffeine").trend === "rising", "Caffeine rising"],
      [(c) => c.v("caffeineFelt") >= PROCESS.caffeineWorkingAboveFelt, "Caffeine fading"],
      [always, "Clear"],
    ],
    level: (c) => Math.max(c.v("caffeineFelt"), c.v("drowsy"), c.v("stressLevel"), c.v("reward")),
    sentence: brainSentence,
  },
  immune: {
    words: [
      [hasFever, (c) => `Fever ${c.v("temperature").toFixed(1)}`],
      [(c) => fighting(c) !== null, "Fighting it"],
      [(c) => c.v("immune") >= REFERENCE.immune.high / 100, "Recovering"],
      [always, "Quiet"],
    ],
    level: (c) => c.v("immune"),
    sentence: immuneSentence,
  },
  clearing: {
    words: [
      [(c) => c.v("alcohol") >= 0.02, "Clearing alcohol"],
      [isDry, "A little dry"],
      [(c) => c.v("caffeine") >= 1, "Clearing caffeine"],
      [(c) => activeSubstance(c) !== undefined, (c) => `Clearing ${inSentence(activeSubstance(c)?.substance.label ?? "")}`],
      [always, "Quiet"],
    ],
    level: (c) => Math.max(c.v("alcohol") * 2, c.v("caffeine") / CAFFEINE.feltAboveMgL / 3, (c.v("bladderMl") / REFERENCE.bladder.capacityMl) * 0.3),
    sentence: clearingSentence,
  },
  reproductive: {
    words: [
      [(c) => phaseOf(c) !== null, (c) => PHASE_WORD[phaseOf(c) ?? "follicular"]],
      [always, "Quiet"],
    ],
    level: (c) => (c.tr.cycle ? CYCLE.cramps.amount * 0.5 : 0),
    sentence: (c) => {
      const phase = phaseOf(c);
      if (phase) return `${PHASE_SAYS[phase].day}.`;
      return c.tr.scenario.body.sex === "female" ? "No cycle logged." : "Nothing here is changing today.";
    },
  },
};

function firstWord(rows: readonly WordRow[], c: Context, reading: (id: ReadingId) => Reading) {
  const row = rows.find(([test]) => test(c, reading));
  if (!row) throw new Error("A word table must end with a row that always passes");
  return { word: typeof row[1] === "string" ? row[1] : row[1](c), quiet: row === rows[rows.length - 1] };
}

type RailEntry = Omit<SystemStatus, "emphasis">;

function systemStatus(id: Exclude<SystemId, "overview">, c: Context, reading: (id: ReadingId) => Reading): RailEntry {
  const spec = SYSTEM_STATUS[id];
  const def = systemById(id);
  return { ...firstWord(spec.words, c, reading), level: clamp01(spec.level(c, reading)), tone: worstTone([...def.readings, ...def.more].map((r) => reading(r).tone)), sentence: spec.sentence(c, reading) };
}

// What matters most right now: what needs attention first, then how busy each system is.
const importance = (s: RailEntry) => (s.quiet ? -1 : TONE_RANK[s.tone] * FEELING_DISPLAY.toneOutweighsLevel + s.level);

function systemsOf(c: Context, reading: (id: ReadingId) => Reading, headline: string): Record<SystemId, SystemStatus> {
  const parts = {
    digestion: systemStatus("digestion", c, reading),
    energy: systemStatus("energy", c, reading),
    circulation: systemStatus("circulation", c, reading),
    muscles: systemStatus("muscles", c, reading),
    brain: systemStatus("brain", c, reading),
    immune: systemStatus("immune", c, reading),
    clearing: systemStatus("clearing", c, reading),
    reproductive: systemStatus("reproductive", c, reading),
  };
  const all = Object.values(parts);
  // Being ill is why the person is looking, however busy the other systems are.
  const rank = (p: RailEntry) => importance(p) + (p === parts.immune && fighting(c) ? FEELING_DISPLAY.toneOutweighsLevel : 0);
  const shown = new Set(all.filter((p) => !p.quiet).sort((a, b) => rank(b) - rank(a)).slice(0, FEELING_DISPLAY.mostEmphasised));
  const marked = (part: RailEntry): SystemStatus => ({ ...part, emphasis: shown.has(part) });
  // The whole body is as busy as its busiest part and as loud as its loudest. Its sentence is the headline.
  const overview: SystemStatus = { ...firstWord(OVERVIEW_WORDS, c, reading), level: Math.max(...all.map((p) => p.level)), tone: worstTone(all.map((p) => p.tone)), sentence: headline, emphasis: false };
  return { overview, digestion: marked(parts.digestion), energy: marked(parts.energy), circulation: marked(parts.circulation), muscles: marked(parts.muscles), brain: marked(parts.brain), immune: marked(parts.immune), clearing: marked(parts.clearing), reproductive: marked(parts.reproductive) };
}

function mealInGut(c: Context): string | null {
  const kcal = c.v("stomachKcal") + c.v("gutKcal");
  if (kcal < 25) return null;
  if (c.lastFood && kcal < foodKcalOf(c.lastFood) * PROCESS.lastOfMealShare) return "the last of a meal";
  return kcal >= 450 ? "a big meal" : kcal >= 150 ? "a meal" : "a snack";
}

function stillWorking(c: Context): string {
  const source = [...c.eaten].reverse().find((i) => i.caffeineMg > 0);
  return c.v("caffeineFelt") >= PROCESS.stillWorkingAboveFelt && source ? `, with your ${inSentence(source.label)} still working` : "";
}

const eventLevel = (e: ResolvedEvent, t: number) => Math.max(0, ...e.effects.map((effect) => curveStrength(effect, e.from, e.ends, t)));
const activeEvent = (c: Context, preset: ResolvedEvent["preset"]) => c.events.find((e) => e.preset === preset && eventLevel(e, c.t) >= MUSCLE_RECOVERY.activeAbove);

// What the body is busy with, most important first. The headline takes up to two. `about` marks a
// clause that restates a reading, so it steps aside when that reading is what stands out most.
const ACTIVITY_ROWS: readonly { test: (c: Context) => boolean; text: (c: Context) => string; about?: ReadingId }[] = [
  { test: (c) => c.training !== null, text: (c) => `Training your ${namesOf(c.training?.muscles ?? [])}` },
  { test: (c) => c.moving, text: (c) => POSTURE_WORD[c.posture] },
  { test: (c) => activeEvent(c, "illness") !== undefined, text: (c) => `Fighting ${activeEvent(c, "illness")?.causeName ?? "an illness"}` },
  { test: (c) => mealInGut(c) !== null, text: (c) => `Digesting ${mealInGut(c)}` },
  { test: (c) => activeEvent(c, "stress") !== undefined && c.v("stressLevel") >= REFERENCE.stressLevel.high / 100, text: () => "Under stress" },
  { test: (c) => activeEvent(c, "sex") !== undefined, text: (c) => (c.t <= (activeEvent(c, "sex")?.ends ?? c.t) ? "Sexual activity under way" : "Recovering after sexual activity") },
  { test: (c) => activeEvent(c, "poor_sleep") !== undefined, text: () => "Short on sleep" },
  { test: (c) => c.v("alcohol") >= 0.05, text: () => "Clearing alcohol", about: "alcohol" },
  { test: (c) => anyMuscle(c, (s) => s.repair >= REFERENCE.muscleState.repairingFrom), text: (c) => `Repairing your ${namesOf(groupsWhere(c, (s) => s.repair >= REFERENCE.muscleState.repairingFrom))}` },
  { test: (c) => activeEvent(c, "custom") !== undefined, text: (c) => `Dealing with ${activeEvent(c, "custom")?.causeName ?? "something"}` },
];

function byTone(readings: Reading[]): Reading[] {
  return readings.filter((r) => r.tone !== "calm").sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
}

const standoutSentence = (r: Reading) => (r.verdictWord === "Fever" ? "You have a fever" : `${r.label} is ${r.verdictWord.toLowerCase()}`);

// Out of range means outside its typical band with nothing to explain it. A fever, however calm, counts.
const outOfRange = (r: Reading) => r.verdict !== "expected" && r.verdict !== "normal" && (r.value < r.scale.typicalLow || r.value > r.scale.typicalHigh);

function headlineOf(c: Context, readings: Reading[]): string {
  const standingOut = byTone(readings);
  const clauses = c.asleep ? ["Asleep"] : ACTIVITY_ROWS.filter((row) => row.test(c) && (row.about === undefined || row.about !== standingOut[0]?.id)).map((row) => row.text(c));
  const fallback = c.lastFood && c.phase !== "fasting" ? "Resting between meals" : "On stored fuel";
  const [first, second] = clauses.length ? clauses : [`${fallback}${stillWorking(c)}`];
  const activity = second ? `${first} and ${inSentence(second)}` : first;
  const reassured = `${activity}. Nothing is out of range.`;
  return readings.some(outOfRange) || reassured.split(/\s+/).length >= PROCESS.sentenceWordsUnder ? `${activity}.` : reassured;
}

export function assess(tr: Trajectory, t: number): Assessment {
  const c = contextAt(tr, t);
  const muscles = muscleSummaries(c);
  const built = new Map<ReadingId, Reading>(READING_ORDER.map((id) => [id, buildReading(id, c)]));
  for (const summary of muscles) built.set(`muscle:${summary.group}`, muscleReading(summary, c));
  const reading = (id: ReadingId) => {
    const found = built.get(id);
    if (!found) throw new Error(`Unknown reading ${id}`);
    return found;
  };
  const readings = [...built.values()];
  const headline = headlineOf(c, readings);
  return {
    headline,
    notable: byTone(readings).map((r) => ({ text: `${standoutSentence(r)}. ${r.why}.`, tone: r.tone, reading: r.id })),
    readings,
    feelings: feelingsOf(c),
    systems: systemsOf(c, reading, headline),
    muscles,
  };
}
