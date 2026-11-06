import { REFERENCE } from "../params";
import { Judgement, MealPhase } from "./types";

export const NORMAL: Judgement = { verdict: "normal", word: "Normal", tone: "calm" };
export const EXPECTED: Judgement = { verdict: "expected", word: "Expected", tone: "calm" };
export const SLIGHTLY_RAISED: Judgement = { verdict: "raised", word: "Slightly raised", tone: "note" };
export const HIGH: Judgement = { verdict: "high", word: "High", tone: "concern" };
export const LOW: Judgement = { verdict: "low", word: "Low", tone: "note" };
export const quiet = (word: string): Judgement => ({ ...NORMAL, word });
// Off the person's own baseline yet inside the healthy range, so it gets a word and no colour.
export const unpainted = (j: Judgement): Judgement => ({ ...j, tone: "calm" });

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
