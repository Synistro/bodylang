import { curveStrength } from "../events/curves";
import { namesOf } from "../events/muscles";
import { ResolvedEvent } from "../events/types";
import { MUSCLE_RECOVERY, PROCESS, REFERENCE } from "../params";
import { foodKcalOf } from "../scenario";
import { inSentence } from "../words";
import type { ReadingId } from "../ids";
import { Context, POSTURE_WORD, anyMuscle, groupsWhere } from "./context";
import { TONE_RANK } from "./systemStatus";
import { Reading } from "./types";

function mealInGut(c: Context): string | null {
  const kcal = c.v("stomachKcal") + c.v("gutKcal");
  if (kcal < REFERENCE.mealSize.snackFromKcal) return null;
  if (c.lastFood && kcal < foodKcalOf(c.lastFood) * PROCESS.lastOfMealShare) return "the last of a meal";
  return kcal >= REFERENCE.mealSize.bigMealFromKcal ? "a big meal" : kcal >= REFERENCE.mealSize.mealFromKcal ? "a meal" : "a snack";
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
  { test: (c) => c.v("alcohol") >= REFERENCE.alcohol.busyLiverFromGPerL, text: () => "Clearing alcohol", about: "alcohol" },
  { test: (c) => anyMuscle(c, (s) => s.repair >= REFERENCE.muscleState.repairingFrom), text: (c) => `Repairing your ${namesOf(groupsWhere(c, (s) => s.repair >= REFERENCE.muscleState.repairingFrom))}` },
  { test: (c) => activeEvent(c, "custom") !== undefined, text: (c) => `Dealing with ${activeEvent(c, "custom")?.causeName ?? "something"}` },
];

export function byTone(readings: Reading[]): Reading[] {
  return readings.filter((r) => r.tone !== "calm").sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
}

export const standoutSentence = (r: Reading) => (r.verdictWord === "Fever" ? "You have a fever" : `${r.label} is ${r.verdictWord.toLowerCase()}`);

// Out of range means outside its typical band with nothing to explain it. A fever, however calm, counts.
const outOfRange = (r: Reading) => r.verdict !== "expected" && r.verdict !== "normal" && (r.value < r.scale.typicalLow || r.value > r.scale.typicalHigh);

export function headlineOf(c: Context, readings: Reading[]): string {
  const standingOut = byTone(readings);
  const clauses = c.asleep ? ["Asleep"] : ACTIVITY_ROWS.filter((row) => row.test(c) && (row.about === undefined || row.about !== standingOut[0]?.id)).map((row) => row.text(c));
  const fallback = c.lastFood && c.phase !== "fasting" ? "Resting between meals" : "On stored fuel";
  const [first, second] = clauses.length ? clauses : [`${fallback}${stillWorking(c)}`];
  const activity = second ? `${first} and ${inSentence(second)}` : first;
  const reassured = `${activity}. Nothing is out of range.`;
  return readings.some(outOfRange) || reassured.split(/\s+/).length >= PROCESS.sentenceWordsUnder ? `${activity}.` : reassured;
}
