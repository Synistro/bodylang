import { crampLevel } from "../cycle";
import { curveStrength } from "../events/curves";
import { muscleStateAt, namesOf } from "../events/muscles";
import { MUSCLE_GROUPS } from "../muscleGroups";
import { ACTIVITY, FEELING_DISPLAY, PROCESS, REFERENCE } from "../params";
import { drowsyFromMeal, drowsyFromSleepPressure, mealDipOf } from "../engine/feel";
import { Intake, kcalOf } from "../scenario";
import { OrganId } from "../ids";
import { hoursWord, whenWords } from "../words";
import { clamp01 } from "../curve";
import {
  Context,
  causeOf,
  clock,
  firstWhen,
  fromMoving,
  hoursAwake,
  nearestMinute,
  peakAhead,
  groupsWhere,
  minutesUntilSleep,
  sorenessPeak,
} from "./context";
import { Feeling } from "./types";

function intensityWord(now: number, later: number): string {
  const d = FEELING_DISPLAY;
  if (now >= d.strongFrom) return "Strong";
  if (later - now >= d.changeShownAbove) return "Building";
  if (now - later >= d.changeShownAbove) return "Fading";
  if (now >= d.moderateFrom) return "Moderate";
  return now >= d.mildFrom ? "Mild" : "Faint";
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
      return meal ? `You ate a meal at ${clock(meal.at)}` : "You ate recently";
    },
  },
  {
    size: (c) => drowsyFromSleepPressure(c.v("sleepPressure")),
    text: (c) => `You have been awake ${hoursWord(hoursAwake(c))}`,
  },
  { size: (c) => c.tr.channels.drowsiness[nearestMinute(c)], text: (c) => `From ${causeOf(c, "drowsiness", 0) ?? ""}` },
  {
    size: (c) =>
      c.v("drowsy") -
      mealDrowsiness(c) -
      drowsyFromSleepPressure(c.v("sleepPressure")) -
      c.tr.channels.drowsiness[nearestMinute(c)],
    text: () => "Your body clock dips in the afternoon",
  },
];

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

const warmth = (share: number) =>
  clamp01((share - FEELING_DISPLAY.warmFlowFrom) / (FEELING_DISPLAY.warmFlowFull - FEELING_DISPLAY.warmFlowFrom)) *
  FEELING_DISPLAY.warmMax;
const alertAboveBaseline = (x: number) => clamp01((x - FEELING_DISPLAY.alertAbove) / (1 - FEELING_DISPLAY.alertAbove));
const mostSore = (c: Context, at: number) =>
  MUSCLE_GROUPS.reduce((most, group) => Math.max(most, muscleStateAt(c.tr.muscleEvents, group, at).soreness), 0);

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
    cause: () => "Your stomach is still well filled",
    when: fadesBelowNegligible("Fades"),
  },
  {
    id: "warm",
    label: "Warm",
    organ: "small_intestine",
    level: (c, at) => warmth(c.v("flowGut", at)),
    cause: () => "Digesting makes heat and pulls blood to your gut",
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
    cause: () => "Your muscles are asking for more oxygen",
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
      return peak && peak.at <= Math.min(c.t + FEELING_DISPLAY.peakHorizonMin, minutesUntilSleep(c))
        ? `Peaks around ${clock(peak.at)}`
        : null;
    },
  },
  {
    id: "alert",
    label: "Alert",
    organ: "brain",
    level: (c, at) => alertAboveBaseline(c.v("alertness", at)),
    cause: (c) =>
      c.v("caffeineFelt") >= PROCESS.caffeineWorkingAboveFelt
        ? "Caffeine is masking your tiredness"
        : hoursAwake(c) < FEELING_DISPLAY.earlyInDayH
          ? "You are early in your day"
          : "Your body clock is at a high point",
    when: fadesBelowNegligible("Fades"),
  },
  {
    id: "jittery",
    label: "Jittery",
    organ: "brain",
    level: (c, at) => c.v("jitter", at),
    cause: () => "You have a lot of caffeine in your blood",
    when: fadesBelowNegligible("Eases"),
  },
  {
    id: "hungry",
    label: "Hungry",
    organ: "stomach",
    level: (c, at) => c.v("hunger", at),
    cause: (c) =>
      c.lastFood ? `Your last food was ${hoursWord((c.t - c.lastFood.at) / 60)} ago` : "You have logged no food today",
    when: () => null,
  },
  {
    id: "low",
    label: "Low energy",
    organ: "liver",
    level: (c, at) => c.v("crash", at),
    cause: () => "Your blood sugar has dipped",
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
    level: (c, at) =>
      clamp01(-c.v("fluidBalance", at) / (c.tr.scenario.body.weightKg * REFERENCE.fluid.impairingShareOfWeight * 1000)),
    cause: () => "You have lost more fluid than you drank",
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
      out.push({
        byClaude: event.preset === "custom",
        id: f.id,
        label: f.label,
        intensity: now,
        word: intensityWord(now, at(c.t + d.changeWindowMin)),
        cause: f.cause,
        when: fades === null ? null : `Fades ${whenWords(fades, c.t)}`,
        organ: f.organ,
      });
    }
  }
  return out;
}

export function feelingsOf(c: Context): Feeling[] {
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
    if (now >= d.negligibleBelow)
      offer({
        id: spec.id,
        label: spec.label,
        intensity: now,
        word: intensityWord(now, level(c.t + d.changeWindowMin)),
        cause: spec.cause(c),
        when: spec.when(c, level),
        organ: spec.organ,
      });
  }
  const logged = eventFeelingsOf(c);
  for (const feeling of logged) offer(feeling);
  // What you told it about comes before what it worked out by itself, such as thirst.
  const rank = (feeling: Feeling) =>
    feeling.intensity + (logged.some((f) => f.id === feeling.id) ? d.loggedOutranksBy : 0);
  return [...strongest.values()].sort((a, b) => rank(b) - rank(a)).slice(0, d.mostShown);
}
