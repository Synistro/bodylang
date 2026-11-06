import type { Cycle } from "./cycle";
import type { BodyEvent } from "./events/types";
import type { OrganId } from "./ids";
import { DAY, KCAL_PER_G } from "./params";

export type Sex = "male" | "female";
export type Posture = "sleeping" | "sitting" | "standing" | "walking" | "running";

export interface Body {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
}

export interface Nutrients {
  grams: number;
  waterMl: number;
  carbsG: number; // total carbohydrate including fiber, as on a US label
  sugarG: number;
  fatG: number;
  proteinG: number;
  fiberG: number;
  caffeineMg: number;
  alcoholG: number;
}

// Where what is in a food comes from: a row of the USDA table, or Claude's own estimate of it.
export type FoodSource =
  | { kind: "table"; fdcId: number; name: string; dataset: string }
  | { kind: "estimate" }
  | { kind: "recipe"; ingredients: { fdcId: number; name: string; grams: number }[] };

// What one serving is, so a portion can be corrected in the units it was eaten in.
export interface Serving {
  label: string;
  grams: number;
}

export interface Intake extends Nutrients {
  id: string;
  label: string;
  at: number;
  liquid?: boolean;
  fructoseShare?: number; // of its sugar; table sugar is 0.5, whole fruit 0.6 to 0.67
  source?: FoodSource;
  serving?: Serving;
  portionBy?: "you"; // set once you have corrected it; until then the portion is Claude's estimate
}

export interface ActivitySpan {
  from: number;
  posture: Posture;
}

export const SUBSTANCE_ROUTES = ["swallowed", "inhaled", "injected"] as const;
export type SubstanceRoute = (typeof SUBSTANCE_ROUTES)[number];

// A substance the core model doesn't know about. Claude supplies the kinetics and says where
// the numbers come from, and the engine moves it through the body like caffeine.
export interface CustomSubstance {
  id: string;
  label: string;
  at: number;
  doseMg: number;
  tmaxMin: number;
  halfLifeH: number;
  volumeLPerKg: number;
  bioavailability: number;
  route?: SubstanceRoute; // how it gets in; swallowed if not said
  targets: { organ: OrganId; effect: string }[];
  source: string;
}

export interface Scenario {
  body: Body;
  intakes: Intake[];
  activities: ActivitySpan[];
  substances: CustomSubstance[];
  events?: BodyEvent[];
  cycle?: Cycle | null;
}

export const POSTURES: Posture[] = ["sleeping", "sitting", "standing", "walking", "running"];

// With nothing said about the night, the body goes to bed at the usual time. A span that starts
// later than that is someone saying they stayed up, so it wins.
export function postureAt(activities: ActivitySpan[], minute: number): Posture {
  let current: Posture = "sleeping";
  let currentFrom = -Infinity;
  for (const a of activities) {
    if (a.from <= minute) {
      current = a.posture;
      currentFrom = a.from;
    }
  }
  return minute >= DAY.sleepMin && currentFrom < DAY.sleepMin ? "sleeping" : current;
}

// Fiber is not digested as carbohydrate. What reaches the colon is counted there.
export const availableCarbsG = (n: Nutrients) => Math.max(0, n.carbsG - n.fiberG);

// What a ledger tracks. Alcohol has a ledger of its own, in grams.
export const foodKcalOf = (n: Nutrients) =>
  availableCarbsG(n) * KCAL_PER_G.carb + n.proteinG * KCAL_PER_G.protein + n.fatG * KCAL_PER_G.fat;

export const kcalOf = (n: Nutrients) => foodKcalOf(n) + n.alcoholG * KCAL_PER_G.alcohol;
