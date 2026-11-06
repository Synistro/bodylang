import { REFERENCE } from "../params";
import { Trajectory } from "../engine/trajectory";
import type { ReadingId } from "../ids";
import {
  Context,
  POSTURE_WORD,
  ReadingSpec,
  ReasonRow,
  Said,
  Sample,
  always,
  contextAt,
  headingOf,
  trendOf,
} from "./context";
import { feelingsOf } from "./feelings";
import { byTone, headlineOf, standoutSentence } from "./headline";
import { muscleReading, muscleSummaries } from "./muscles";
import { alcoholSpec, alertnessSpec, caffeineSpec, receptorsSpec } from "./readings/brain";
import {
  bloodPressureSpec,
  bloodShareSpec,
  breathingSpec,
  flowLitres,
  gutShareSpec,
  heartSpec,
  outputSpec,
} from "./readings/circulation";
import { absorbingSpec, stomachSpec } from "./readings/digestion";
import {
  burnSpec,
  fuelSpec,
  glucoseSpec,
  glycogenSpec,
  insulinSpec,
  muscleUptakeSpec,
  triglycerideSpec,
} from "./readings/energy";
import {
  bladderSpec,
  cycleDaySpec,
  estradiolSpec,
  fluidSpec,
  immuneSpec,
  inflammationSpec,
  progesteroneSpec,
  rewardSpec,
  stressSpec,
  temperatureSpec,
} from "./readings/wholeBody";
import { systemsOf } from "./systemStatus";
import { Assessment, Reading, TableReadingId } from "./types";

// In the order they are built. A fever comes first, so it leads the notable list when it ties with something else.
const READINGS: Record<TableReadingId, ReadingSpec> = {
  temperature: temperatureSpec,
  glucose: glucoseSpec,
  insulin: insulinSpec,
  tg: triglycerideSpec,
  hr: heartSpec,
  output: outputSpec,
  bloodPressure: bloodPressureSpec,
  breaths: breathingSpec,
  flowGut: gutShareSpec,
  flowMuscle: bloodShareSpec("flowMuscle", "Blood to muscle", "muscle", REFERENCE.bloodFlow.muscle, [
    [(c) => c.moving, (c) => `${POSTURE_WORD[c.posture]} sends more blood to your legs`],
    [always, () => "Resting muscle needs little blood"],
  ]),
  flowBrain: bloodShareSpec("flowBrain", "Blood to brain", "brain", REFERENCE.bloodFlow.brain, [
    [always, (c, s) => `Your brain keeps a steady ${flowLitres(c, s)} L a minute`],
  ]),
  flowKidneys: bloodShareSpec("flowKidneys", "Blood to kidneys", "kidneys", REFERENCE.bloodFlow.kidneys, [
    [always, (c, s) => `Your kidneys receive ${flowLitres(c, s)} L a minute`],
  ]),
  stomach: stomachSpec,
  absorbing: absorbingSpec,
  glycogen: glycogenSpec,
  muscleUptake: muscleUptakeSpec,
  burn: burnSpec,
  fuel: fuelSpec,
  caffeine: caffeineSpec,
  receptors: receptorsSpec,
  alertness: alertnessSpec,
  stressLevel: stressSpec,
  reward: rewardSpec,
  inflammation: inflammationSpec,
  immune: immuneSpec,
  alcohol: alcoholSpec,
  bladder: bladderSpec,
  fluid: fluidSpec,
  cycleDay: cycleDaySpec,
  estradiol: estradiolSpec,
  progesterone: progesteroneSpec,
};

const READING_ORDER = Object.keys(READINGS) as TableReadingId[];

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
export function readingCurve(
  tr: Trajectory,
  id: ReadingId,
  now: number,
): { valueAt: (minute: number) => number; textAt: (minute: number) => string } | null {
  if (!isTableReading(id)) return null;
  const spec = READINGS[id];
  const c = contextAt(tr, now);
  const series = tr.series[spec.series];
  const valueAt = (minute: number) =>
    spec.toValue(series[Math.max(0, Math.min(series.length - 1, Math.round(minute)))], c);
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
