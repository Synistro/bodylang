import { PROCESS, STOMACH } from "../params";
import { Ledger, ledgerAt, Trajectory } from "../engine/trajectory";
import { foodKcalOf, Intake } from "../scenario";
import { OrganId } from "../ids";
import type { RouteId } from "../ids";
import {
  Draft,
  Process,
  clock,
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

const kcal = (x: number) => `${Math.round(x)} kcal`;
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
        return `${kcal(f.l.stomach)} of ${kcal(f.total)} is still here. The outlet opens about ${STOMACH.solidLagMin} minutes after you eat.`;
      return `${kcal(f.l.stomach)} of ${kcal(f.total)} is still here. It leaves at about ${f.emptying.toFixed(1)} kcal a minute${f.fatHeavy ? ", slowed by fat" : ""}.`;
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
        return `${kcal(f.l.intestine)} is here. Enzymes split it into sugar, fat and amino acids, and the wall absorbs them.`;
      return f.eaten && f.total - f.l.stomach >= 1
        ? "All absorbed."
        : `Nothing here yet. Food starts arriving about ${STOMACH.solidLagMin} minutes after you eat.`;
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
        ? `Blood from the gut reaches your liver first. It has kept ${kcal(f.l.liver)}, as glycogen and new proteins.`
        : "Blood from the gut reaches your liver first. It keeps some and passes the rest on.",
  },
  {
    key: "blood",
    organ: "heart",
    label: "Blood",
    routes: ["liver_out", "arch"],
    flow: (f) => flowRate(f.rate("blood") + f.rate("muscle") + f.rate("fat") + f.rate("burned"), FOOD_FULL_FLOW),
    say: (f) => {
      if (f.l.blood >= 0.5)
        return `${kcal(f.l.blood)} is in your blood, as sugar, fat and amino acids heading for your cells.`;
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
        ? `Your muscles hold ${kcal(f.l.muscle)} of this. Insulin opens them to sugar${f.muscleClause}.`
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
        ? `${kcal(f.l.fat)} is stored so far. Meal fat travels by lymph, so it comes later than sugar.`
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
        ? `Your cells burned ${kcal(f.l.burned)} of this. The carbon leaves as CO₂ when you breathe out.`
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
        ? `${kcal(f.l.colon)} moves on to your colon: fiber and what your intestine couldn't absorb.`
        : "Fiber and what your intestine can't absorb move on to your colon.",
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
      [`${percent(shareOf(l.fat, total))} stored as fat`, l.fat],
      [`${percent(shareOf(l.liver, total))} in your liver`, l.liver],
      [`${percent(shareOf(l.muscle, total))} in your muscles`, l.muscle],
      [`${percent(shareOf(l.burned, total))} burned`, l.burned],
    ];
    return `Digested. ${stores
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map((s) => s[0])
      .join(", ")}`;
  }
  if (inStomach >= PROCESS.mostlyInStomachShare) {
    const moving = shareOf(l.intestine + l.blood + l.liver + l.muscle + l.fat, total) >= PROCESS.firstArrivalShare;
    return moving
      ? `${percent(inStomach)} still in your stomach, only the first sugar has reached your blood`
      : `${percent(inStomach)} still in your stomach, just eaten`;
  }
  if (inStomach >= PROCESS.stillInStomachShare)
    return `${percent(inStomach)} still in your stomach, ${percent(settled)} stored or burned`;
  if (l.intestine >= l.stomach)
    return `${percent(shareOf(l.intestine, total))} left in your intestine, ${percent(settled)} stored or burned`;
  return `${percent(inStomach)} left in your stomach, ${percent(settled)} stored or burned`;
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
