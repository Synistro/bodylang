import { muscleStateAt, MuscleState } from "../events";
import { MUSCLE_GROUPS, MUSCLE_LABEL, MuscleGroup } from "../muscleGroups";
import { MUSCLE_RECOVERY, REFERENCE } from "../params";
import { Trajectory } from "../engine/trajectory";
import { whenWords } from "../words";
import { Context, sessionEnd, startedMuscleEvents, muscleLevel } from "./context";
import { MuscleSummary, Reading, Tone } from "./types";

// The status table for muscle groups, first passing row wins.
const MUSCLE_STATUS: readonly [test: (s: MuscleState) => boolean, word: string][] = [
  [(s) => s.work >= REFERENCE.muscleState.workingFrom, "Working"],
  [(s) => s.soreness >= REFERENCE.muscleState.soreFrom, "Sore"],
  [(s) => s.fatigue >= REFERENCE.muscleState.tiredFrom, "Tired"],
  [(s) => s.repair >= REFERENCE.muscleState.repairingFrom, "Repairing"],
];

const RESTED = "Rested";
const muscleWord = (s: MuscleState) => MUSCLE_STATUS.find(([test]) => test(s))?.[1] ?? RESTED;

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

export function muscleSummaries(c: Context): MuscleSummary[] {
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

export function muscleReading(summary: MuscleSummary, c: Context): Reading {
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
