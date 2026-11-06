import { MuscleState } from "../events/types";
import { MuscleGroup } from "../muscleGroups";
import { Evidence } from "../params";
import { SeriesName } from "../engine/trajectory";
import { OrganId, SystemId } from "../ids";
import type { ReadingId } from "../ids";

// Readings read from a curve in the table below. Muscle summaries are built per group.
export type TableReadingId = Exclude<ReadingId, `muscle:${MuscleGroup}`>;

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
