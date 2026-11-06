import { PROCESS } from "../params";
import { Ledger, ledgerAt, Trajectory } from "../engine/trajectory";
import { foodKcalOf, Intake } from "../scenario";
import { OrganId } from "../ids";
import { aboutClock, howMuch, startCase } from "../words";
import type { RouteId } from "../ids";
import {
  Draft,
  Process,
  clock,
  endsAt,
  flowRate,
  hasStarted,
  mealProcessId,
  mealTitle,
  numbered,
  percent,
  postureAt,
  shareOf,
} from "./line";

interface FoodView {
  eaten: boolean;
  l: Ledger;
  total: number;
  rate: (key: keyof Ledger) => number;
  emptying: number;
  fatHeavy: boolean;
  muscleClause: string;
  stomachDone: number | null;
}

interface FoodStop {
  key: keyof Ledger;
  organ: OrganId;
  label: string;
  routes: RouteId[];
  from?: string;
  flow: (f: FoodView) => number;
  say: (f: FoodView) => string;
}

const FOOD_FULL_FLOW = PROCESS.fullFlow.kcalPerMin;
const arrivalFlow = (key: keyof Ledger) => (f: FoodView) => flowRate(f.rate(key), FOOD_FULL_FLOW);

// The line every food follows. The ledger's keys are the stop ids, so shares add up to the whole.
const FOOD_STOPS: FoodStop[] = [
  {
    key: "stomach",
    organ: "stomach",
    label: "Stomach",
    routes: ["esophagus"],
    flow: () => 0,
    say: (f) => {
      if (!f.eaten) return "It lands here later.";
      if (f.l.stomach < f.total * PROCESS.presentShare) return "Your stomach has passed it all on.";
      if (f.emptying < PROCESS.stomachStillBelowKcalPerMin)
        return "Your stomach is churning this into small pieces. Nothing leaves until they are small enough.";
      const pace = f.fatHeavy
        ? "Fat makes your stomach let food out slowly"
        : "Your stomach lets it through a little at a time";
      return `${startCase(howMuch(f.l.stomach / f.total))} of it is still here. ${pace}${f.stomachDone === null ? "" : `, until about ${aboutClock(f.stomachDone)}`}.`;
    },
  },
  {
    key: "intestine",
    organ: "small_intestine",
    label: "Small intestine",
    routes: ["stomach_out", "duodenum", "jejunum"],
    flow: (f) => flowRate(f.emptying, FOOD_FULL_FLOW),
    say: (f) => {
      if (f.l.intestine >= 1)
        return "Enzymes are splitting this into sugar, fat and amino acids, and your gut wall is absorbing them.";
      return f.eaten && f.total - f.l.stomach >= 1
        ? "All absorbed."
        : "Nothing here yet. Food starts arriving once your stomach opens.";
    },
  },
  {
    key: "liver",
    organ: "liver",
    label: "Liver",
    routes: ["portal_liver"],
    flow: arrivalFlow("liver"),
    say: (f) =>
      f.l.liver >= 1
        ? "Blood from your gut reaches your liver first. It keeps some as fuel for later and builds proteins from some."
        : "Blood from the gut reaches your liver first. It keeps some and passes the rest on.",
  },
  {
    key: "blood",
    organ: "heart",
    label: "Blood",
    routes: ["liver_out", "arch"],
    flow: (f) => flowRate(f.rate("blood") + f.rate("muscle") + f.rate("fat") + f.rate("burned"), FOOD_FULL_FLOW),
    say: (f) => {
      if (f.l.blood >= 0.5) return "Sugar, fat and amino acids are riding your blood out to your cells.";
      return f.total - f.l.stomach - f.l.intestine >= 1
        ? "It has moved on from your blood to your cells."
        : "Nothing in your blood yet. Sugar and amino acids arrive first, fat much later.";
    },
  },
  {
    key: "muscle",
    organ: "muscle",
    label: "Muscle",
    from: "blood",
    routes: ["descending", "leg_L"],
    flow: arrivalFlow("muscle"),
    say: (f) =>
      f.l.muscle >= 1
        ? `Your muscles are refuelling from this. Insulin opens them to sugar${f.muscleClause}.`
        : `Insulin opens your muscles to sugar${f.muscleClause}. Nothing has arrived yet.`,
  },
  {
    key: "fat",
    organ: "fat",
    label: "Fat",
    from: "intestine",
    routes: ["lymph"],
    flow: arrivalFlow("fat"),
    say: (f) =>
      f.l.fat >= 1
        ? "Some of this is going into storage. Meal fat travels by lymph, so it arrives after the sugar."
        : "Meal fat travels by lymph, so it reaches your fat tissue hours after the sugar.",
  },
  {
    key: "burned",
    organ: "lungs",
    label: "Burned",
    from: "blood",
    routes: ["to_lung_L", "to_lung_R"],
    flow: arrivalFlow("burned"),
    say: (f) =>
      f.l.burned >= 1
        ? "Your cells are burning some of this for energy. The carbon leaves as CO₂ when you breathe out."
        : "Your cells burn some of this for energy. The carbon leaves as CO₂ when you breathe out.",
  },
  {
    key: "colon",
    organ: "large_intestine",
    label: "Colon",
    from: "intestine",
    routes: ["ileum", "colon"],
    flow: arrivalFlow("colon"),
    say: (f) =>
      f.l.colon >= 1
        ? "Fiber and what your gut couldn't absorb are moving on to your colon."
        : "Fiber and what your gut can't absorb move on to your colon.",
  },
];

// A sitting's ledger is what its intakes hold between them, so its shares still add up to the whole.
function ledgerOf(tr: Trajectory, group: Intake[], t: number): Ledger {
  const total: Ledger = { stomach: 0, intestine: 0, blood: 0, liver: 0, muscle: 0, fat: 0, burned: 0, colon: 0 };
  for (const intake of group) {
    const ledger = ledgerAt(tr, intake.id, t);
    if (!ledger) throw new Error(`No ledger for intake ${intake.id}`);
    total.stomach += ledger.stomach;
    total.intestine += ledger.intestine;
    total.blood += ledger.blood;
    total.liver += ledger.liver;
    total.muscle += ledger.muscle;
    total.fat += ledger.fat;
    total.burned += ledger.burned;
    total.colon += ledger.colon;
  }
  return total;
}

const ledgerTotal = (l: Ledger) => l.stomach + l.intestine + l.blood + l.liver + l.muscle + l.fat + l.burned + l.colon;

// The action sits at the back of the bulk: the stomach until it has let most go, then the intestine,
// then wherever the last of it is still landing.
function foodHere(tr: Trajectory, group: Intake[], t: number, l: Ledger, total: number): string | null {
  if (l.stomach + l.intestine + l.blood < total * PROCESS.finishedBelowShare) return null;
  if (l.stomach >= total * PROCESS.stomachHereAboveShare) return "stomach";
  if (l.intestine >= total * PROCESS.intestineHereAboveShare) return "intestine";
  const later = ledgerOf(tr, group, t + PROCESS.arrivingWindowMin);
  const landing: [string, number][] = [
    ["liver", later.liver - l.liver],
    ["blood", l.blood],
    ["muscle", later.muscle - l.muscle],
    ["fat", later.fat - l.fat],
  ];
  return landing.reduce((best, next) => (next[1] > best[1] ? next : best))[0];
}

function foodHeadline(l: Ledger, total: number, active: boolean): string {
  const settled = shareOf(l.liver + l.muscle + l.fat + l.burned + l.colon, total);
  const inStomach = shareOf(l.stomach, total);
  if (!active) {
    const stores: [string, number][] = [
      ["your fat stores", l.fat],
      ["your liver", l.liver],
      ["your muscles", l.muscle],
      ["energy", l.burned],
    ];
    const [first, second] = stores.sort((a, b) => b[1] - a[1]);
    return `Digested. It mostly went to ${first[0]} and ${second[0]}`;
  }
  if (inStomach >= PROCESS.mostlyInStomachShare) {
    const moving = shareOf(l.intestine + l.blood + l.liver + l.muscle + l.fat, total) >= PROCESS.firstArrivalShare;
    return moving
      ? "Still in your stomach, with only the first sugar reaching your blood"
      : "Just eaten, and all still in your stomach";
  }
  if (inStomach >= PROCESS.stillInStomachShare)
    return `${startCase(howMuch(inStomach))} still in your stomach, and ${howMuch(settled)} already stored or burned`;
  if (l.intestine >= l.stomach) return `Your gut is absorbing what's left, and ${howMuch(settled)} is stored or burned`;
  return `The last of it is leaving your stomach, and ${howMuch(settled)} is stored or burned`;
}

export function foodProcess(tr: Trajectory, group: Intake[], t: number): Process {
  const at = group[0].at;
  const eaten = hasStarted(at, t);
  const l = ledgerOf(tr, group, t);
  const before = ledgerOf(tr, group, t - PROCESS.flowWindowMin);
  const after = ledgerOf(tr, group, t + PROCESS.flowWindowMin);
  const rate = (key: keyof Ledger) => (after[key] - before[key]) / (PROCESS.flowWindowMin * 2);
  const total = ledgerTotal(l);
  const posture = postureAt(tr, t);
  const allKcal = group.reduce((sum, intake) => sum + foodKcalOf(intake), 0);
  const fatKcal = group.reduce((sum, intake) => sum + intake.fatG * 9, 0);
  const view: FoodView = {
    eaten,
    l,
    total,
    rate,
    emptying: Math.max(0, -rate("stomach")),
    fatHeavy: fatKcal >= allKcal * PROCESS.fatHeavyShare,
    muscleClause:
      posture === "sitting"
        ? ", slowly while you sit"
        : posture === "walking" || posture === "running"
          ? ", quickly while you move"
          : "",
    stomachDone: eaten
      ? endsAt((minute) => ledgerOf(tr, group, minute).stomach >= total * PROCESS.presentShare, Math.ceil(t))
      : null,
  };
  const swallowing = eaten && t - at < PROCESS.swallowedForMin;
  const drafts: Draft[] = FOOD_STOPS.map((stop) => ({
    id: stop.key,
    organ: stop.organ,
    label: stop.label,
    reading: percent(shareOf(l[stop.key], total)),
    share: shareOf(l[stop.key], total),
    flow: stop.key === "stomach" && swallowing ? 1 : stop.flow(view),
    say: stop.say(view),
    from: stop.from,
    routes: stop.routes,
  }));
  const here = eaten ? foodHere(tr, group, t, l, total) : null;
  const active = here !== null;
  return {
    id: mealProcessId(group),
    title: mealTitle(group),
    system: "digestion",
    substance: "chyme",
    active,
    headline: eaten ? foodHeadline(l, total, active) : `Logged for ${clock(at)}`,
    stops: numbered(drafts, here, eaten ? "passed" : "ahead"),
  };
}

// ---- A dose of something that crosses the gut, reaches the blood, acts, then gets cleared.
