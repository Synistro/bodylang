import { assess, readingCurve } from "./assess/assess";
import { hasSomethingToSay, Reading } from "./assess/types";
import { normalAgainAt } from "./assess/muscles";
import { ReadingId, OrganId } from "./ids";
import { eventLevelAt, muscleStateAt, MuscleState, ResolvedEvent } from "./events";
import { MuscleGroup } from "./muscleGroups";
import { DAY, LANES, MUSCLE_RECOVERY, REFERENCE } from "./params";
import { mealGroups, mealProcessId, Process } from "./processes/line";
import { processesAt } from "./processes/processes";
import { alcoholLedgerAt, caffeineLedgerAt, ledgerAt, Trajectory } from "./engine/trajectory";
import { foodKcalOf, Intake } from "./scenario";
import { formatClock, levelWord, whenWords } from "./words";
import type { SystemId } from "./ids";
import { systemById } from "./systems";
import { Thread, threadsAt } from "./threads";

// One row of the day chart. At every level the chart answers the same question about what that level
// is showing: what is going on, how much, and when does it end?
//
// Two shapes, because two different questions are being asked of the curve. Something that runs out,
// such as a meal in the gut, is an amount: a bar as thick as what is left, which stops when it is over.
// Something that never runs out, such as a heart rate, is a level: a line against its typical band.
export interface Lane {
  id: string;
  label: string;
  system: SystemId; // whose colour it draws in; the overview draws in a neutral colour
  badge: { kind: "number"; number: number } | { kind: "plain" };
  shape: "amount" | "level";
  values: Float32Array; // 0 to 1 of the lane's height, one sample every LANES.stepMin from LANES.from
  band: { low: number; high: number; label: string } | null; // the typical range on the same 0 to 1, for a level
  ghost: Float32Array | null; // your real day on the same scale, while exploring a what-if
  sameAsYourDay?: boolean; // compared with your real day, and no different from it
  hypothetical: boolean; // only exists in a what-if
  read: (minute: number) => string; // what is there at that minute, with its unit or in words
  mark: { at: number; text: string; over: boolean } | null; // over: the thing has ended here, so nothing is drawn after it
  beyond: string | null; // said at the right edge when the end falls past the drawn day
  target: { kind: "process"; id: string } | { kind: "organ"; organ: OrganId } | { kind: "muscle"; group: MuscleGroup } | { kind: "stop"; number: number } | null;
  organ: OrganId | null; // lit on the body while you point at the lane
}

// Something that happened, which the chart names along its top and lets you jump to.
export interface Moment {
  at: number;
  label: string;
  intakes: string[]; // what can be corrected by clicking it
}

// The stretch of time a lane's values cover, and how often they are sampled.
export interface Span {
  from: number;
  to: number;
  stepMin: number;
}

export const DAY_SPAN: Span = { from: LANES.from, to: LANES.to, stepMin: LANES.stepMin };

const samplesOf = (span: Span) => Math.floor((span.to - span.from) / span.stepMin) + 1;

const NOT_COMPARED = { ghost: null, hypothetical: false };
const SAMPLES = samplesOf(DAY_SPAN);
const NOTHING = 0.005;
const ended = (text: string, at: number) => ({ at, text: `${text} ${formatClock(at)}`, over: true });
const percent = (share: number) => `${Math.round(share * 100)}%`;
const seriesAt = (series: Float32Array, minute: number) => series[Math.max(0, Math.min(series.length - 1, Math.round(minute)))];

export const laneMinute = (index: number) => LANES.from + index * LANES.stepMin;

// Scaled to its own fullest point over the drawn day.
function fromLevels(level: (minute: number) => number): Float32Array {
  const values = new Float32Array(SAMPLES);
  let peak = 0;
  for (let i = 0; i < SAMPLES; i++) {
    values[i] = level(laneMinute(i));
    peak = Math.max(peak, values[i]);
  }
  if (peak > 0) for (let i = 0; i < SAMPLES; i++) values[i] /= peak;
  return values;
}

// Already 0 to 1, where a half is a half: a mild soreness draws thinner than a strong one.
export function fromSeverity(level: (minute: number) => number, span: Span = DAY_SPAN): Float32Array {
  const values = new Float32Array(samplesOf(span));
  for (let i = 0; i < values.length; i++) values[i] = Math.min(1, level(span.from + i * span.stepMin));
  return values;
}

// The first drawn moment after `after` that a level has dropped below `floor`, searched in the chart's own steps.
function firstBelow(level: (minute: number) => number, after: number, floor: number): number | null {
  for (let m = Math.ceil(after / LANES.stepMin) * LANES.stepMin; m <= LANES.to; m += LANES.stepMin) if (level(m) < floor) return m;
  return null;
}

function peakOf(level: (minute: number) => number, span: Span = DAY_SPAN) {
  let peak = 0;
  const samples = samplesOf(span);
  for (let i = 0; i < samples; i++) peak = Math.max(peak, level(span.from + i * span.stepMin));
  return peak;
}

function peakMinute(level: (minute: number) => number) {
  let best = LANES.from;
  for (let i = 0; i < SAMPLES; i++) if (level(laneMinute(i)) > level(best)) best = laneMinute(i);
  return best;
}

function foodLevel(tr: Trajectory, group: Intake[]) {
  return (minute: number) => {
    let inGut = 0;
    let total = 0;
    for (const intake of group) {
      if (intake.at > minute) continue;
      const ledger = ledgerAt(tr, intake.id, minute);
      const kcal = foodKcalOf(intake);
      if (ledger && kcal > 0) {
        inGut += ledger.stomach + ledger.intestine;
        total += kcal;
      }
    }
    return total > 0 ? inGut / total : 0;
  };
}

type ThreadShape = Pick<Lane, "values" | "read" | "mark" | "beyond">;

function eventShape(event: ResolvedEvent, now: number): ThreadShape {
  const level = (minute: number) => eventLevelAt(event, minute);
  const horizon = now + LANES.eventLookaheadDays * 1440;
  let ends: number | null = null;
  for (let m = Math.max(now, event.from) + LANES.eventLookaheadStepMin; m <= horizon && ends === null; m += LANES.eventLookaheadStepMin) {
    if (level(m) < MUSCLE_RECOVERY.activeAbove) ends = m;
  }
  const open = event.ends === null;
  return {
    values: fromSeverity(level),
    read: (minute) => (minute < event.from ? "" : levelWord(level(minute))),
    mark: !open && ends !== null && ends <= LANES.to ? ended("Over", ends) : null,
    beyond: open ? "Still going" : ends !== null && ends > LANES.to ? `Over ${whenWords(ends, now)}` : null,
  };
}

// Each thing you told the body about, in the terms it ends in: food gets digested, caffeine thins
// out by bedtime, alcohol clears, a dose wears off, an event settles.
function threadShape(tr: Trajectory, thread: Thread, now: number): ThreadShape {
  const { processId } = thread;
  const event = tr.events.find((e) => `event:${e.id}` === processId);
  if (event) return eventShape(event, now);

  const group = mealGroups(tr.scenario.intakes).find((g) => mealProcessId(g) === processId);
  if (group) {
    const level = foodLevel(tr, group);
    const ends = firstBelow(level, group[0].at + LANES.stepMin, LANES.foodDigestedBelowShare);
    return {
      values: fromLevels(level),
      read: (minute) => (minute < group[0].at ? "" : level(minute) < LANES.foodDigestedBelowShare ? "digested" : `${percent(level(minute))} left`),
      mark: ends === null ? null : ended("Digested", ends),
      beyond: ends === null ? "Digested tomorrow" : null,
    };
  }

  const drinkId = /^(?:alcohol|intake):(.+)$/.exec(processId)?.[1];
  const drink = tr.scenario.intakes.find((intake) => intake.id === drinkId);
  if (drink && drink.alcoholG > 0) {
    const level = (minute: number) => alcoholLedgerAt(tr, drink.id, minute)?.blood ?? 0;
    const peak = peakOf(level);
    const ends = firstBelow((minute) => tr.series.alcohol[minute], peakMinute(level), REFERENCE.alcohol.presentAboveGPerL);
    return {
      values: fromLevels(level),
      read: (minute) => (minute < drink.at ? "" : `${seriesAt(tr.series.alcohol, minute).toFixed(2)} g/L`),
      mark: peak > 0 && ends !== null ? ended("Clear", ends) : null,
      beyond: ends === null ? "Clear tomorrow" : null,
    };
  }
  if (drink && drink.caffeineMg > 0) {
    // Caffeine thins out for most of a day, so what matters is how much of the cup is left at bedtime.
    const atBed = caffeineLedgerAt(tr, drink.id, DAY.sleepMin);
    const left = atBed ? atBed.blood / atBed.dose : 0;
    const share = (minute: number) => {
      const ledger = caffeineLedgerAt(tr, drink.id, minute);
      return ledger ? ledger.blood / ledger.dose : 0;
    };
    return {
      values: fromLevels(share),
      read: (minute) => (minute < drink.at ? "" : `${percent(share(minute))} left`),
      mark: now < DAY.sleepMin && left > 0 ? { at: DAY.sleepMin, text: `${percent(left)} left at ${formatClock(DAY.sleepMin)}`, over: false } : null,
      beyond: null,
    };
  }

  const substance = tr.scenario.substances.find((s) => `substance:${s.id}` === processId);
  const series = substance ? tr.substances.get(substance.id)?.series : undefined;
  if (substance && series) {
    const level = (minute: number) => seriesAt(series, minute);
    const floor = peakOf(level) * LANES.doseGoneBelowShareOfPeak;
    const ends = firstBelow(level, peakMinute(level), floor);
    return {
      values: fromLevels(level),
      read: (minute) => (minute < substance.at ? "" : `${level(minute).toFixed(1)} mg/L`),
      mark: ends === null ? null : ended("Worn off", ends),
      beyond: null,
    };
  }
  throw new Error(`No way to draw thread ${thread.id} with process ${processId}`);
}

// Level 0: everything you told the body about, still going first, then whatever finished last.
export function threadLanes(tr: Trajectory, now: number, real: Trajectory | null = null): Lane[] {
  const realIds = real ? new Set(threadsAt(real, now).map((thread) => thread.id)) : null;
  return threadsAt(tr, now)
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at)
    .map((thread) => ({
      id: thread.id,
      label: thread.name,
      system: "overview",
      badge: { kind: "plain" },
      shape: "amount",
      band: null,
      ghost: null,
      hypothetical: realIds !== null && !realIds.has(thread.id),
      ...threadShape(tr, thread, now),
      target: { kind: "process", id: thread.processId },
      organ: null,
    }));
}

function readingLane(tr: Trajectory, reading: Reading, now: number, system: SystemId, real: Trajectory | null): Lane[] {
  const curve = readingCurve(tr, reading.id, now);
  if (!curve) return [];
  const realCurve = real ? readingCurve(real, reading.id, now) : null;
  let low = Infinity;
  let high = -Infinity;
  let differs = false;
  for (let i = 0; i < SAMPLES; i++) {
    const v = curve.valueAt(laneMinute(i));
    low = Math.min(low, v);
    high = Math.max(high, v);
    if (realCurve) {
      const r = realCurve.valueAt(laneMinute(i));
      low = Math.min(low, r);
      high = Math.max(high, r);
      if (Math.abs(r - v) > Math.abs(v) * LANES.ghostShownAboveShare) differs = true;
    }
  }
  // Nothing all day leaves nothing to draw. The page already says so in a word.
  if (low === 0 && high === 0) return [];
  const empties = low >= 0 && low <= high * LANES.nothingLeftBelowShareOfPeak;
  const values = new Float32Array(SAMPLES);
  const ghost = realCurve && differs ? new Float32Array(SAMPLES) : null;
  let band: Lane["band"] = null;
  if (empties) {
    for (let i = 0; i < SAMPLES; i++) {
      values[i] = (curve.valueAt(laneMinute(i)) - low) / (high - low);
      if (ghost && realCurve) ghost[i] = (realCurve.valueAt(laneMinute(i)) - low) / (high - low);
    }
  } else {
    // A level is drawn against what is typical, so "is this normal?" reads straight off the line.
    let from = Math.min(low, reading.scale.typicalLow);
    let to = Math.max(high, reading.scale.typicalHigh);
    const floor = Math.max(Math.abs(from), Math.abs(to)) * LANES.leastRangeShare || 1;
    if (to - from < floor) {
      const middle = (from + to) / 2;
      from = middle - floor / 2;
      to = middle + floor / 2;
    }
    const margin = (to - from) * LANES.levelMarginShare;
    const y = (v: number) => (v - from + margin) / (to - from + 2 * margin);
    for (let i = 0; i < SAMPLES; i++) {
      values[i] = y(curve.valueAt(laneMinute(i)));
      if (ghost && realCurve) ghost[i] = y(realCurve.valueAt(laneMinute(i)));
    }
    band = { low: y(reading.scale.typicalLow), high: y(reading.scale.typicalHigh), label: `Typical ${reading.scale.typicalLabel}` };
  }
  // A forecast that lands on empty is where the thing ends.
  const forecastAt = reading.forecastAt;
  const emptyThere = forecastAt !== null && empties && values[Math.max(0, Math.min(SAMPLES - 1, Math.round((forecastAt - LANES.from) / LANES.stepMin)))] <= LANES.fit.overBelowShare;
  return [
    {
      id: reading.id,
      label: reading.label,
      system,
      badge: { kind: "plain" },
      shape: empties ? "amount" : "level",
      values,
      band,
      ghost,
      sameAsYourDay: realCurve !== null && !differs,
      hypothetical: false,
      read: curve.textAt,
      mark: reading.forecastShort && forecastAt !== null ? { at: forecastAt, text: reading.forecastShort, over: emptyThere } : null,
      beyond: reading.forecastAt === null ? reading.forecast : null,
      target: reading.organ ? { kind: "organ", organ: reading.organ } : null,
      organ: reading.organ,
    },
  ];
}

// Level 1 and most of level 3: the readings on screen, each with what the model says comes next.
export function readingLanes(tr: Trajectory, now: number, ids: readonly ReadingId[], system: SystemId, real: Trajectory | null = null): Lane[] {
  const assessment = assess(tr, now);
  return ids
    .flatMap((id) => assessment.readings.find((r) => r.id === id) ?? [])
    .filter(hasSomethingToSay)
    .flatMap((reading) => readingLane(tr, reading, now, system, real));
}

// A process is about what happens over time, so a reading that is at zero this minute still has its
// story to tell. Only what stays at nothing all day drops out.
function storyLanes(tr: Trajectory, now: number, ids: readonly ReadingId[], system: SystemId, real: Trajectory | null): Lane[] {
  const assessment = assess(tr, now);
  return ids
    .flatMap((id) => assessment.readings.find((r) => r.id === id) ?? [])
    .flatMap((reading) => readingLane(tr, reading, now, system, real));
}

const STATE_LANES: { key: keyof MuscleState; label: string }[] = [
  { key: "soreness", label: "Sore" },
  { key: "repair", label: "Repairing" },
  { key: "fatigue", label: "Tired" },
  { key: "work", label: "Working" },
];

// The Muscles system: every group that has been worked, hardest first, with its own recovery date.
export function workedMuscleLanes(tr: Trajectory, now: number, span: Span = DAY_SPAN): Lane[] {
  const worked = assess(tr, now)
    .muscles.filter((m) => m.level >= MUSCLE_RECOVERY.activeAbove)
    .sort((a, b) => b.level - a.level);
  return worked.map((muscle) => {
    const level = (minute: number) => {
      const s = muscleStateAt(tr.muscleEvents, muscle.group, minute);
      return Math.max(s.work, s.fatigue, s.soreness, s.repair);
    };
    return {
      id: muscle.group,
      label: muscle.label,
      system: "muscles" as const,
      badge: { kind: "plain" as const },
      shape: "amount" as const,
      values: fromSeverity(level, span),
      band: null,
      ...NOT_COMPARED,
      read: (minute: number) => levelWord(level(minute)),
      mark: null,
      beyond: muscle.normalLine ?? muscle.sorenessLine,
      target: { kind: "muscle" as const, group: muscle.group },
      organ: null,
    };
  });
}

// One muscle in close-up: the phases it goes through after work, each on its own lane.
export function muscleStateLanes(tr: Trajectory, now: number, group: MuscleGroup, span: Span = DAY_SPAN): Lane[] {
  const summary = assess(tr, now).muscles.find((m) => m.group === group);
  const said: Partial<Record<keyof MuscleState, string | null>> = { soreness: summary?.sorenessLine ?? null, repair: summary?.normalLine ?? null };
  return STATE_LANES.flatMap(({ key, label }) => {
    const level = (minute: number) => muscleStateAt(tr.muscleEvents, group, minute)[key];
    if (peakOf(level, span) < MUSCLE_RECOVERY.activeAbove) return [];
    return [{ id: key, label, system: "muscles" as const, badge: { kind: "plain" as const }, shape: "amount" as const, values: fromSeverity(level, span), band: null, ...NOT_COMPARED, read: (minute: number) => levelWord(level(minute)), mark: null, beyond: said[key] ?? null, target: null, organ: null }];
  });
}

// Processes that aren't one thing moving through the body have no "how much is where". What they have
// is readings, so that is what they draw.
const PROCESS_READINGS: Partial<Record<string, ReadingId[]>> = {
  insulin: ["glucose", "insulin", "muscleUptake", "glycogen"],
  "fat-route": ["tg", "fuel"],
  circulation: ["hr", "output", "flowGut", "flowMuscle"],
  alertness: ["alertness", "caffeine", "receptors"],
  clearing: ["caffeine", "alcohol", "bladder", "fluid"],
  cycle: ["cycleDay", "estradiol", "progesterone"],
};
const EVENT_READINGS: Partial<Record<ResolvedEvent["preset"], ReadingId[]>> = {
  illness: ["temperature", "inflammation", "immune"],
  stress: ["stressLevel", "hr", "bloodPressure"],
  sex: ["hr", "reward"],
  poor_sleep: ["alertness"],
};

// Level 2: for one thing moving through the body, how much of it is at each stop across the day, with
// the same numbers as the line. Anything else draws what describes it.
export function processLanes(tr: Trajectory, now: number, processId: string, real: Trajectory | null = null): Lane[] {
  const process: Process | undefined = processesAt(tr, now).find((p) => p.id === processId);
  if (!process) return [];
  const readings = PROCESS_READINGS[processId];
  if (readings) return storyLanes(tr, now, readings, process.system, real);
  const event = tr.events.find((e) => `event:${e.id}` === processId);
  if (event) {
    if (event.preset === "training") return workedMuscleLanes(tr, now).filter((lane) => event.muscles.some((m) => m.group === lane.id));
    const ids = EVENT_READINGS[event.preset];
    if (ids) return storyLanes(tr, now, ids, process.system, real);
    return threadLanes(tr, now).filter((lane) => lane.id === processId).map((lane) => ({ ...lane, system: process.system }));
  }
  const shares = process.stops.map(() => new Float32Array(SAMPLES));
  for (let i = 0; i < SAMPLES; i++) {
    const at = processesAt(tr, laneMinute(i)).find((p) => p.id === processId);
    if (!at) continue;
    at.stops.forEach((stop, s) => {
      if (shares[s]) shares[s][i] = stop.share;
    });
  }
  const peaks = shares.map((share) => share.reduce((most, v) => Math.max(most, v), 0));
  const kept = new Set(
    process.stops
      .map((_, s) => s)
      .filter((s) => peaks[s] >= LANES.stopWorthALaneFrom),
  );
  return process.stops.flatMap((stop, s) => {
    if (!kept.has(s)) return [];
    const peak = peaks[s];
    const share = shares[s];
    const at = (minute: number) => share[Math.max(0, Math.min(SAMPLES - 1, Math.round((minute - LANES.from) / LANES.stepMin)))];
    const clears = firstBelow(at, peakMinute(at), peak * LANES.stopClearBelowShareOfPeak);
    return [
      {
        id: stop.id,
        label: stop.label,
        system: process.system,
        badge: { kind: "number" as const, number: stop.number },
        shape: "amount" as const,
        values: fromLevels(at),
        band: null,
        ...NOT_COMPARED,
        read: (minute: number) => percent(at(minute)),
        mark: clears === null ? null : ended("Clear", clears),
        beyond: null,
        target: { kind: "stop" as const, number: stop.number },
        organ: stop.organ,
      },
    ];
  });
}

export function systemLanes(tr: Trajectory, now: number, system: SystemId, real: Trajectory | null = null): Lane[] {
  if (system === "overview") return threadLanes(tr, now, real);
  if (system === "muscles") return workedMuscleLanes(tr, now);
  return readingLanes(tr, now, systemById(system).readings, system, real);
}

// What you logged today, in order, to name along the top of the chart.
export function dayMoments(tr: Trajectory, now: number): Moment[] {
  const meals = mealGroups(tr.scenario.intakes);
  // The foods and drinks a moment stands for, which are what you can correct by clicking it.
  const intakesOf = (threadId: string) => {
    const meal = meals.find((group) => mealProcessId(group) === threadId);
    if (meal) return meal.map((intake) => intake.id);
    return tr.scenario.intakes.filter((intake) => threadId === `intake:${intake.id}`).map((intake) => intake.id);
  };
  return threadsAt(tr, now)
    .filter((thread) => thread.at >= LANES.from && thread.at <= LANES.to)
    .map((thread) => ({ at: thread.at, label: thread.name, intakes: intakesOf(thread.id) }))
    .sort((a, b) => a.at - b.at);
}

// Everything worth stopping at on the chart, in order: what you logged, each named moment, and now.
export function dayStops(lanes: Lane[], moments: Moment[], now: number): { at: number; label: string | null }[] {
  const stops = [{ at: now, label: null as string | null }, ...moments, ...lanes.flatMap((lane) => (lane.mark ? [{ at: lane.mark.at, label: null }] : []))];
  return stops.sort((a, b) => a.at - b.at);
}

// The stretch of the day worth looking at: from where what is going on began to the last moment the
// model names, always with some past and some future around now. A slow tail with no named end doesn't
// count, and neither does anything else that is flat line and would only squeeze the rest.
export function fitWindow(lanes: Lane[], now: number): { from: number; to: number } {
  const fit = LANES.fit;
  const at = Math.max(LANES.from, Math.min(LANES.to, now));
  let from = at - fit.pastMin;
  let to = at + fit.aheadMin;
  const index = Math.round((at - LANES.from) / LANES.stepMin);
  for (const lane of lanes) {
    if (lane.shape === "amount") {
      let start = index;
      while (start > 0 && lane.values[start] <= NOTHING) start--;
      if (lane.values[start] > NOTHING) {
        while (start > 0 && lane.values[start - 1] > NOTHING) start--;
        from = Math.min(from, laneMinute(start) - fit.marginMin);
      }
    }
    if (lane.mark && lane.mark.at > at) to = Math.max(to, lane.mark.at + fit.marginMin);
  }
  from = Math.max(LANES.from, from);
  to = Math.min(LANES.to, to);
  if (to - from < fit.leastSpanMin) {
    const missing = fit.leastSpanMin - (to - from);
    to = Math.min(LANES.to, to + missing);
    from = Math.max(LANES.from, to - fit.leastSpanMin);
  }
  return { from, to };
}

export type MuscleSubject = { kind: "one"; group: MuscleGroup } | { kind: "worked"; groups: readonly MuscleGroup[] | null };

export interface Recovery {
  span: Span;
  lanes: Lane[];
  moments: Moment[];
}

const snapToStep = (minute: number, stepMin: number) => Math.round(minute / stepMin) * stepMin;

// A muscle recovers over days, so a chart of today only shows a flat stretch of it. This is the whole of it:
// from the session to feeling normal again, while there is something to recover from.
export function recoveryOf(tr: Trajectory, now: number, subject: MuscleSubject): Recovery | null {
  const groups = subject.kind === "one" ? [subject.group] : assess(tr, now).muscles.filter((m) => m.level >= MUSCLE_RECOVERY.activeAbove && (subject.groups?.includes(m.group) ?? true)).map((m) => m.group);
  const level = (minute: number) =>
    groups.reduce((most, group) => {
      const s = muscleStateAt(tr.muscleEvents, group, minute);
      return Math.max(most, s.work, s.fatigue, s.soreness, s.repair);
    }, 0);
  if (level(now) < MUSCLE_RECOVERY.activeAbove) return null;
  const reach = LANES.eventLookaheadDays * 1440;
  let start = now;
  while (start > now - reach && level(start - LANES.eventLookaheadStepMin) >= MUSCLE_RECOVERY.activeAbove) start -= LANES.eventLookaheadStepMin;
  const normal = new Map(groups.map((group) => [group, normalAgainAt(tr, group, now)]));
  const latestNormal = Math.max(now, ...[...normal.values()].flatMap((at) => at ?? []));
  const length = latestNormal - start;
  const span: Span = { from: snapToStep(start - length * LANES.days.marginShare, LANES.days.stepMin), to: snapToStep(latestNormal + length * LANES.days.tailShare, LANES.days.stepMin), stepMin: LANES.days.stepMin };
  const normalMark = (at: number) => ({ at, text: `Normal ${whenWords(at, now)}`, over: false });
  const lanes =
    subject.kind === "one"
      ? muscleStateLanes(tr, now, subject.group, span).map((lane) => {
          const at = normal.get(subject.group) ?? null;
          return { ...lane, mark: lane.id === "soreness" && at !== null ? normalMark(at) : null, beyond: null };
        })
      : workedMuscleLanes(tr, now, span)
          .filter((lane) => groups.some((group) => group === lane.id))
          .map((lane) => {
            const at = groups.flatMap((group) => (group === lane.id ? (normal.get(group) ?? []) : []))[0] ?? null;
            return { ...lane, mark: at === null ? null : normalMark(at), beyond: null };
          });
  const moments = tr.muscleEvents
    .filter((event) => event.from >= span.from && event.from <= span.to && event.muscles.some((m) => groups.includes(m.group)))
    .map((event) => ({ at: event.from, label: event.label, intakes: [] }))
    .sort((a, b) => a.at - b.at);
  return { span, lanes, moments };
}

// Whether a page's curves have nothing to say: every one a reading sitting inside its typical range, moving
// too little to see. An amount on its way out always has something to say, and so does anything out of range.
export function isStill(lanes: Lane[], now: number): boolean {
  const { from, to } = fitWindow(lanes, now);
  const first = Math.round((from - LANES.from) / LANES.stepMin);
  const last = Math.round((to - LANES.from) / LANES.stepMin);
  const here = Math.round((Math.max(LANES.from, Math.min(LANES.to, now)) - LANES.from) / LANES.stepMin);
  return lanes.every((lane) => {
    if (lane.shape !== "level" || !lane.band || lane.ghost || lane.hypothetical) return false;
    if (lane.values[here] < lane.band.low || lane.values[here] > lane.band.high) return false;
    let low = Infinity;
    let high = -Infinity;
    for (let i = first; i <= last; i++) {
      low = Math.min(low, lane.values[i]);
      high = Math.max(high, lane.values[i]);
    }
    return high - low < LANES.stillBelowShare;
  });
}

export interface Ahead {
  reading: Reading;
  at: number;
  what: string; // "You'll want to go"
}

// What the model expects next today, soonest first. `among` narrows it to the readings of one page.
export function aheadOf(tr: Trajectory, now: number, among: ReadonlySet<string> | null): Ahead[] {
  return assess(tr, now)
    .readings.flatMap((reading) => {
      const { forecastAt: at, forecastShort: said } = reading;
      if (at === null || said === null || at <= now || at > LANES.to || (among && !among.has(reading.id))) return [];
      const clock = ` ${formatClock(at)}`;
      return [{ reading, at, what: said.endsWith(clock) ? said.slice(0, -clock.length) : said }];
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, LANES.aheadMost);
}
