import { cycleDay, cyclePhase, liningShare, lutealShare } from "./cycle";
import type { BodyView } from "./extensions/api";
import { EXTENSIONS } from "./extensions";
import { ChannelId, currentStopIndex, effectAt, eventActiveAt, eventLevelAt, EventStop, isMuscleState, muscleStateFromEvent, namesOf, ResolvedEvent } from "./events";
import type { MuscleGroup } from "./muscleGroups";
import { ALCOHOL, BLOOD_FLOW, CYCLE, DAY, FEEL, GLUCOSE, INSULIN, KIDNEY, PROCESS, REFERENCE, STOMACH } from "./params";
import { alcoholLedgerAt, caffeineLedgerAt, intakeFlowsAt, Ledger, ledgerAt, SeriesName, substanceLedgerAt, Trajectory, value } from "./engine/trajectory";
import { alcoholVolumeL } from "./engine/anthropometrics";
import { CustomSubstance, foodKcalOf, SubstanceRoute, Intake, POSTURES } from "./scenario";
import { OrganId } from "./ids";
import { formatClock, hoursWord, inSentence, joinAnd, levelWord, startCase, whenWords } from "./words";
import type { SystemId, RouteId, Substance } from "./ids";
import { clamp01 } from "./curve";


// Named paths through the body, defined in src/scene/flows.ts. A stop lists the ones leading to it.

export type StopState = "passed" | "here" | "ahead";

export interface ProcessStop {
  id: string;
  number: number; // 1-based, shown on the body and in the panel
  organ: OrganId | null;
  muscle: MuscleGroup | null; // a stop can point at one muscle group, with organ "muscle" alongside
  label: string; // "Stomach"
  reading: string; // "95%", "530 ml", "1.4×"
  share: number; // 0 to 1: how much of the thing is at this stop now
  state: StopState;
  flow: number; // 0 to 1: how fast it is moving into this stop right now; draws line weight and pulses
  say: string; // One or two plain sentences on what happens at this stop now. Shown during a walkthrough.
  from: string | null; // id of the stop this one branches from; null means the previous stop
  routes: RouteId[]; // the path from that stop to this one
}

export interface Process {
  id: string; // "intake:pizza", "insulin", "circulation", "alertness", "clearing", "fat-route"
  title: string; // "Pizza"
  system: SystemId;
  substance: Substance;
  alsoIn?: SystemId[]; // other systems this crosses, such as a workout showing under Heart & lungs
  active: boolean; // false when nothing is happening in it right now; the panel lists these quietly
  headline: string; // "95% still in your stomach, the first sugar is reaching your blood"
  stops: ProcessStop[];
}

// A stop before it is numbered and placed on its line.
interface Draft {
  id: string;
  organ: OrganId | null;
  muscle?: MuscleGroup | null;
  label: string;
  reading: string;
  share: number;
  flow: number;
  say: string;
  from?: string;
  routes: RouteId[];
}

const percent = (x: number) => `${Math.round(x * 100)}%`;
const clock = formatClock;
const shareOf = (part: number, total: number) => (total > 0 ? part / total : 0);
const flowRate = (rate: number, full: number) => clamp01(Math.max(0, rate) / full);
const hasStarted = (at: number, t: number) => at <= t;

// A zero says nothing a person can use, whatever its unit.
const NOTHING_THERE = /^0(\.0+)?( |%|$)/;

// Markers read along a line: what the action has left behind, where it is, what is next. A stop
// behind you says nothing. On a live line everything keeps going at once, so nothing is behind you.
function numbered(drafts: Draft[], here: string | null, withoutHere: StopState, live = false): ProcessStop[] {
  const at = here === null ? -1 : drafts.findIndex((d) => d.id === here);
  return drafts.map((d, i) => {
    const state: StopState = at < 0 ? withoutHere : i === at ? "here" : i < at && !live ? "passed" : "ahead";
    return {
      id: d.id,
      number: i + 1,
      organ: d.organ,
      muscle: d.muscle ?? null,
      label: d.label,
      reading: state === "passed" || NOTHING_THERE.test(d.reading) ? "" : d.reading,
      share: clamp01(d.share),
      state,
      flow: clamp01(d.flow),
      say: d.say,
      from: d.from ?? null,
      routes: d.routes,
    };
  });
}

function peakAfter(tr: Trajectory, name: SeriesName, t: number, horizon: number = REFERENCE.headingHorizonMin) {
  const series = tr.series[name];
  const start = Math.max(0, Math.min(DAY.minutes, Math.ceil(t)));
  const end = Math.min(DAY.minutes, start + horizon);
  let at = start;
  for (let m = start; m <= end; m++) if (series[m] > series[at]) at = m;
  // A window can close mid-climb. Follow the curve until it turns so a reported peak is a real one.
  if (at === end) while (at < DAY.minutes && series[at + 1] > series[at]) at++;
  return { at, value: series[at], ahead: at > t + 2 };
}

const postureAt = (tr: Trajectory, t: number) => POSTURES[Math.round(value(tr, "posture", t))];
// Coffee with a splash of milk follows the caffeine alone; anything else with calories gets digested.
const isCaffeineDrink = (intake: Intake) => intake.caffeineMg > 0 && foodKcalOf(intake) < PROCESS.drinkOnlyBelowKcal;
export const hasFoodLine = (intake: Intake) => foodKcalOf(intake) > 0 && !isCaffeineDrink(intake);

// What you ate at one sitting, followed as one thing. Each group has at least one intake.
export function mealGroups(intakes: Intake[]): Intake[][] {
  const groups: Intake[][] = [];
  for (const intake of [...intakes].filter(hasFoodLine).sort((a, b) => a.at - b.at)) {
    const open = groups.find((group) => intake.at - group[0].at <= PROCESS.sameSittingMin);
    if (open) open.push(intake);
    else groups.push([intake]);
  }
  return groups;
}

export const mealProcessId = (group: Intake[]) => (group.length > 1 ? `meal:${group[0].id}` : `intake:${group[0].id}`);

export function mealTitle(group: Intake[]): string {
  const names = joinAnd(group.map((intake) => inSentence(intake.label)));
  return group.every((intake) => intake.liquid) ? `Drank ${names}` : `Ate ${names}`;
}

// ---- What you ate, followed through the conserved ledger.

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
      if (f.emptying < PROCESS.stomachStillBelowKcalPerMin) return `${kcal(f.l.stomach)} of ${kcal(f.total)} is still here. The outlet opens about ${STOMACH.solidLagMin} minutes after you eat.`;
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
      if (f.l.intestine >= 1) return `${kcal(f.l.intestine)} is here. Enzymes split it into sugar, fat and amino acids, and the wall absorbs them.`;
      return f.eaten && f.total - f.l.stomach >= 1 ? "All absorbed." : `Nothing here yet. Food starts arriving about ${STOMACH.solidLagMin} minutes after you eat.`;
    },
  },
  {
    key: "liver",
    organ: "liver",
    label: "Liver",
    routes: ["portal_liver"],
    flow: arrivalFlow("liver"),
    say: (f) => (f.l.liver >= 1 ? `Blood from the gut reaches your liver first. It has kept ${kcal(f.l.liver)}, as glycogen and new proteins.` : "Blood from the gut reaches your liver first. It keeps some and passes the rest on."),
  },
  {
    key: "blood",
    organ: "heart",
    label: "Blood",
    routes: ["liver_out", "arch"],
    flow: (f) => flowRate(f.rate("blood") + f.rate("muscle") + f.rate("fat") + f.rate("burned"), FOOD_FULL_FLOW),
    say: (f) => {
      if (f.l.blood >= 0.5) return `${kcal(f.l.blood)} is in your blood, as sugar, fat and amino acids heading for your cells.`;
      return f.total - f.l.stomach - f.l.intestine >= 1 ? "It has moved on from your blood to your cells." : "Nothing in your blood yet. Sugar and amino acids arrive first, fat much later.";
    },
  },
  {
    key: "muscle",
    organ: "muscle",
    label: "Muscle",
    from: "blood",
    routes: ["descending", "leg_L"],
    flow: arrivalFlow("muscle"),
    say: (f) => (f.l.muscle >= 1 ? `Your muscles hold ${kcal(f.l.muscle)} of this. Insulin opens them to sugar${f.muscleClause}.` : `Insulin opens your muscles to sugar${f.muscleClause}. Nothing has arrived yet.`),
  },
  {
    key: "fat",
    organ: "fat",
    label: "Fat",
    from: "intestine",
    routes: ["lymph"],
    flow: arrivalFlow("fat"),
    say: (f) => (f.l.fat >= 1 ? `${kcal(f.l.fat)} is stored so far. Meal fat travels by lymph, so it comes later than sugar.` : "Meal fat travels by lymph, so it reaches your fat tissue hours after the sugar."),
  },
  {
    key: "burned",
    organ: "lungs",
    label: "Burned",
    from: "blood",
    routes: ["to_lung_L", "to_lung_R"],
    flow: arrivalFlow("burned"),
    say: (f) => (f.l.burned >= 1 ? `Your cells burned ${kcal(f.l.burned)} of this. The carbon leaves as CO₂ when you breathe out.` : "Your cells burn some of this for energy. The carbon leaves as CO₂ when you breathe out."),
  },
  {
    key: "colon",
    organ: "large_intestine",
    label: "Colon",
    from: "intestine",
    routes: ["ileum", "colon"],
    flow: arrivalFlow("colon"),
    say: (f) => (f.l.colon >= 1 ? `${kcal(f.l.colon)} moves on to your colon: fiber and what your intestine couldn't absorb.` : "Fiber and what your intestine can't absorb move on to your colon."),
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
    return `Digested. ${stores.sort((a, b) => b[1] - a[1]).slice(0, 2).map((s) => s[0]).join(", ")}`;
  }
  if (inStomach >= PROCESS.mostlyInStomachShare) {
    const moving = shareOf(l.intestine + l.blood + l.liver + l.muscle + l.fat, total) >= PROCESS.firstArrivalShare;
    return moving ? `${percent(inStomach)} still in your stomach, only the first sugar has reached your blood` : `${percent(inStomach)} still in your stomach, just eaten`;
  }
  if (inStomach >= PROCESS.stillInStomachShare) return `${percent(inStomach)} still in your stomach, ${percent(settled)} stored or burned`;
  if (l.intestine >= l.stomach) return `${percent(shareOf(l.intestine, total))} left in your intestine, ${percent(settled)} stored or burned`;
  return `${percent(inStomach)} left in your stomach, ${percent(settled)} stored or burned`;
}

function foodProcess(tr: Trajectory, group: Intake[], t: number): Process {
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
    muscleClause: posture === "sitting" ? ", slowly while you sit" : posture === "walking" || posture === "running" ? ", quickly while you move" : "",
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

interface DoseLedger {
  stomach: number;
  intestine: number;
  blood: number;
  cleared: number;
  dose: number;
}

interface DoseView {
  l: DoseLedger;
  started: boolean;
  clearingPerMin: number;
  emptyingPerMin: number;
  absorbingPerMin: number;
}

// Where a dose crosses into the blood.
interface DoseEntry {
  organ: OrganId;
  label: string;
  routesIn: RouteId[];
  routesToBlood: RouteId[];
}

const THROUGH_THE_GUT: DoseEntry = { organ: "small_intestine", label: "Small intestine", routesIn: ["stomach_out", "duodenum", "jejunum"], routesToBlood: ["portal_liver", "liver_out", "arch"] };

// Everything that differs between one dose line and another.
interface DoseLine {
  id: string;
  title: string;
  system: SystemId;
  substance: Substance;
  at: number;
  ledger: (minute: number) => DoseLedger;
  fullRate: number;
  fullClearRate: number;
  entry?: DoseEntry | null; // where it crosses into the blood, the gut unless said; null when it goes straight in
  effects: (d: DoseView) => Draft[]; // what it does once it is in the blood; counted under Blood
  working: (d: DoseView) => boolean;
  settlesAt: (d: DoseView) => string; // where the action sits once it has crossed the gut
  say: {
    stomach: ((d: DoseView) => string) | null; // null for what the model moves straight to the gut
    intestine: (d: DoseView) => string;
    blood: (d: DoseView) => string;
    cleared: (d: DoseView) => string;
  };
  clearedLabel: string;
  headline: { working: (d: DoseView) => string; done: (d: DoseView) => string };
}

function doseProcess(line: DoseLine, t: number): Process {
  const l = line.ledger(t);
  const before = line.ledger(t - PROCESS.flowWindowMin);
  const after = line.ledger(t + PROCESS.flowWindowMin);
  const window = PROCESS.flowWindowMin * 2;
  const clearingPerMin = Math.max(0, (after.cleared - before.cleared) / window);
  const started = hasStarted(line.at, t);
  const d: DoseView = {
    l,
    started,
    clearingPerMin,
    emptyingPerMin: Math.max(0, (before.stomach - after.stomach) / window),
    absorbingPerMin: Math.max(0, (after.blood - before.blood) / window) + clearingPerMin,
  };
  const share = (x: number) => shareOf(x, l.dose);
  const hasStomach = line.say.stomach !== null;
  const entry = line.entry === undefined ? THROUGH_THE_GUT : line.entry;
  const stomachStops: Draft[] = line.say.stomach
    ? [
        {
          id: "stomach",
          organ: "stomach",
          label: "Stomach",
          reading: percent(share(l.stomach)),
          share: share(l.stomach),
          flow: started && t - line.at < PROCESS.swallowedForMin ? 1 : 0,
          say: line.say.stomach(d),
          routes: ["esophagus"],
        },
      ]
    : [];
  const entryStops: Draft[] = entry
    ? [
        {
          id: "intestine",
          organ: entry.organ,
          label: entry.label,
          reading: percent(share(l.intestine)),
          share: share(l.intestine),
          flow: flowRate(hasStomach ? d.emptyingPerMin : d.absorbingPerMin, line.fullRate),
          say: line.say.intestine(d),
          routes: entry.routesIn,
        },
      ]
    : [];
  const drafts: Draft[] = [
    ...stomachStops,
    ...entryStops,
    {
      id: "blood",
      organ: "heart",
      label: "Blood",
      reading: percent(share(l.blood)),
      share: share(l.blood),
      flow: flowRate(d.absorbingPerMin, line.fullRate),
      say: line.say.blood(d),
      routes: entry?.routesToBlood ?? [],
    },
    ...line.effects(d),
    {
      id: "liver",
      organ: "liver",
      label: line.clearedLabel,
      reading: percent(share(l.cleared)),
      share: share(l.cleared),
      flow: flowRate(clearingPerMin, line.fullClearRate),
      say: line.say.cleared(d),
      from: "blood",
      routes: ["to_liver_art"],
    },
  ];
  const stillCrossing = l.stomach + l.intestine >= l.dose * PROCESS.finishedBelowShare;
  const active = started && (line.working(d) || stillCrossing);
  let here: string | null = null;
  if (active) {
    if (l.blood >= l.stomach + l.intestine) here = line.settlesAt(d);
    else if (hasStomach && l.stomach >= l.dose * PROCESS.stomachHereAboveShare && l.stomach >= l.intestine) here = "stomach";
    else if (l.intestine >= l.dose * PROCESS.stomachHereAboveShare) here = "intestine";
    else here = line.settlesAt(d);
  }
  return {
    id: line.id,
    title: line.title,
    system: line.system,
    substance: line.substance,
    active,
    headline: !started ? `Logged for ${clock(line.at)}` : active ? line.headline.working(d) : line.headline.done(d),
    stops: numbered(drafts, here, started ? "passed" : "ahead"),
  };
}

function caffeineTotals(tr: Trajectory, t: number) {
  let blood = 0;
  let dose = 0;
  let cleared = 0;
  for (const intake of tr.scenario.intakes) {
    const ledger = caffeineLedgerAt(tr, intake.id, t);
    if (ledger && hasStarted(intake.at, t)) {
      blood += ledger.blood;
      dose += ledger.dose;
      cleared += ledger.cleared;
    }
  }
  return { blood, dose, cleared };
}

const caffeineHalfLifeH = (tr: Trajectory) => tr.anthro.caffeineHalfLifeH;
const mg = (x: number) => `${Math.round(x)} mg`;

function caffeineLine(tr: Trajectory, intake: Intake, t: number): DoseLine {
  const name = inSentence(intake.label);
  const ledger = (minute: number): DoseLedger => {
    const found = caffeineLedgerAt(tr, intake.id, minute);
    if (!found) throw new Error(`No caffeine ledger for intake ${intake.id}`);
    return found;
  };
  // Several drinks block receptors together, so each one gets the share of its own milligrams.
  const ownShare = (d: DoseView) => shareOf(d.l.blood, caffeineTotals(tr, t).blood);
  const blockedPerHundred = (d: DoseView) => Math.round(value(tr, "occupancy", t) * ownShare(d) * 100);
  const feltFrom = (d: DoseView) => value(tr, "caffeineFelt", t) * ownShare(d);
  const blocked = (d: DoseView) => `${blockedPerHundred(d)}% of the tired signal blocked`;
  return {
    id: hasFoodLine(intake) ? `caffeine:${intake.id}` : `intake:${intake.id}`,
    title: hasFoodLine(intake) ? `Caffeine in the ${name}` : `Drank ${name}`,
    system: "brain",
    substance: "caffeine",
    at: intake.at,
    ledger,
    fullRate: PROCESS.fullFlow.caffeineMgPerMin,
    fullClearRate: PROCESS.fullFlow.clearedMgPerMin,
    effects: (d) => [
      {
        id: "brain",
        organ: "brain",
        label: "Brain",
        reading: `${blockedPerHundred(d)}% blocked`,
        share: 0,
        flow: feltFrom(d),
        say: blockedPerHundred(d) >= 1 ? `Caffeine sits where the tired signal, adenosine, would land, stopping ${blockedPerHundred(d)} of every 100. So you feel less sleepy.` : "Almost none of the tired signal is blocked now.",
        routes: ["carotid"],
      },
    ],
    working: (d) => feltFrom(d) >= PROCESS.caffeineWorkingAboveFelt,
    settlesAt: (d) => (feltFrom(d) >= PROCESS.caffeineWorkingAboveFelt ? "blood" : "liver"),
    say: {
      stomach: (d) => (!d.started ? "It lands here later." : d.l.stomach >= d.l.dose * PROCESS.presentShare ? `${mg(d.l.stomach)} of ${mg(d.l.dose)} is still here. Drinks leave the stomach quickly.` : "It has left your stomach."),
      intestine: (d) => (d.l.intestine >= d.l.dose * PROCESS.presentShare ? `${mg(d.l.intestine)} is here, crossing the gut wall into your blood.` : d.started ? "It has all crossed the gut wall." : "Caffeine crosses the gut wall into your blood here."),
      blood: (d) => (d.l.blood >= 1 ? `${mg(d.l.blood)} of ${mg(d.l.dose)} is still in your blood, ${value(tr, "caffeine", t).toFixed(2)} mg/L. Half of it leaves every ${caffeineHalfLifeH(tr)} hours.` : "Blood carries caffeine to every organ within minutes."),
      cleared: (d) => (d.l.cleared >= 1 ? `Your liver has cleared ${mg(d.l.cleared)}, ${percent(shareOf(d.l.cleared, d.l.dose))} of it. It removes about ${(d.clearingPerMin * 60).toFixed(1)} mg an hour now.` : "Your liver breaks caffeine down, slowly and steadily."),
    },
    clearedLabel: "Cleared by liver",
    headline: {
      working: (d) => (d.l.stomach + d.l.intestine > d.l.blood ? `Reaching your blood, ${percent(shareOf(d.l.blood, d.l.dose))} so far` : `${percent(shareOf(d.l.blood, d.l.dose))} still in your blood, ${blocked(d)}`),
      done: (d) => `Worn off. ${percent(shareOf(d.l.cleared, d.l.dose))} cleared by your liver, ${percent(shareOf(d.l.blood, d.l.dose))} left in your blood`,
    },
  };
}

function alcoholLine(tr: Trajectory, intake: Intake, t: number): DoseLine {
  const name = inSentence(intake.label);
  const grams = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)} g`;
  const level = value(tr, "alcohol", t);
  const inBlood = level >= REFERENCE.alcohol.presentAboveGPerL;
  const ledger = (minute: number): DoseLedger => {
    const found = alcoholLedgerAt(tr, intake.id, minute);
    if (!found) throw new Error(`No alcohol ledger for intake ${intake.id}`);
    return found;
  };
  return {
    id: `alcohol:${intake.id}`,
    title: hasFoodLine(intake) ? `Alcohol in the ${name}` : `Drank ${name}`,
    system: "clearing",
    substance: "alcohol",
    at: intake.at,
    ledger,
    fullRate: PROCESS.fullFlow.alcoholGPerMin,
    fullClearRate: PROCESS.fullFlow.alcoholGPerMin,
    effects: () => [
      {
        id: "brain",
        organ: "brain",
        label: "Brain",
        reading: `${level.toFixed(2)} g/L`,
        share: 0,
        flow: clamp01(level / REFERENCE.alcohol.limitGPerL),
        say: inBlood ? `At ${level.toFixed(2)} g/L alcohol slows signals between nerve cells. Reaction time and judgement slip as it rises.` : "No alcohol is reaching your brain now.",
        routes: ["carotid"],
      },
    ],
    working: () => inBlood,
    settlesAt: () => (level >= REFERENCE.alcohol.newDriverLimitGPerL ? "blood" : "liver"),
    say: {
      stomach: (d) => (!d.started ? "It lands here later." : d.l.stomach >= d.l.dose * PROCESS.presentShare ? `${grams(d.l.stomach)} of ${grams(d.l.dose)} of alcohol is still here. Food in your stomach holds it back.` : "It has left your stomach."),
      intestine: (d) => (d.l.intestine >= d.l.dose * PROCESS.presentShare ? `${grams(d.l.intestine)} is here. Alcohol crosses the gut wall quickly.` : "Alcohol crosses the gut wall quickly here."),
      blood: () => (inBlood ? `Your blood reads ${level.toFixed(2)} g/L. Crash risk climbs from ${REFERENCE.alcohol.riskGPerL} g/L.` : "Alcohol spreads through your blood and body water within minutes."),
      cleared: (d) => `Your liver has cleared ${grams(d.l.cleared)} of this. It works at about ${ALCOHOL.eliminationGPerLPerH} g/L an hour, a little faster after food.`,
    },
    clearedLabel: "Cleared by liver",
    headline: {
      working: (d) => `Your blood reads ${level.toFixed(2)} g/L, ${percent(shareOf(d.l.cleared, d.l.dose))} of this already cleared`,
      done: () => "Your liver has cleared it",
    },
  };
}

const TARGET_ROUTES: Record<OrganId, RouteId[]> = {
  brain: ["carotid"],
  heart: [],
  lungs: ["to_lung_L", "to_lung_R"],
  liver: ["to_liver_art"],
  stomach: ["descending", "to_gut"],
  pancreas: ["descending", "to_gut"],
  spleen: ["descending", "to_gut"],
  small_intestine: ["descending", "to_gut"],
  large_intestine: ["descending", "to_gut"],
  kidneys: ["descending", "to_kidney_L", "to_kidney_R"],
  bladder: ["descending", "to_kidney_L", "to_bladder_L"],
  muscle: ["descending", "leg_L"],
  fat: ["descending"],
  uterus: ["descending"],
  ovaries: ["descending"],
  prostate: ["descending"],
};

const TARGET_SYSTEM: Record<OrganId, SystemId> = {
  brain: "brain",
  heart: "circulation",
  lungs: "circulation",
  liver: "clearing",
  stomach: "digestion",
  pancreas: "energy",
  spleen: "clearing",
  small_intestine: "digestion",
  large_intestine: "digestion",
  kidneys: "clearing",
  bladder: "clearing",
  muscle: "energy",
  fat: "energy",
  uterus: "reproductive",
  ovaries: "reproductive",
  prostate: "reproductive",
};

const SUBSTANCE_ENTRY: Record<SubstanceRoute, { entry: DoseEntry | null; verb: string; crossing: string }> = {
  swallowed: {
    entry: { ...THROUGH_THE_GUT, routesIn: ["esophagus", "stomach_out", "duodenum", "jejunum"] },
    verb: "Took",
    crossing: "crossing the gut wall",
  },
  inhaled: {
    entry: { organ: "lungs", label: "Lungs", routesIn: [], routesToBlood: ["from_lung_L", "from_lung_R", "arch"] },
    verb: "Inhaled",
    crossing: "crossing from the air sacs into the blood",
  },
  injected: { entry: null, verb: "Injected", crossing: "going straight into the blood" },
};

function substanceLine(tr: Trajectory, substance: CustomSubstance, t: number): DoseLine {
  const way = SUBSTANCE_ENTRY[substance.route ?? "swallowed"];
  const track = tr.substances.get(substance.id);
  if (!track) throw new Error(`No ledger for substance ${substance.id}`);
  const available = substance.doseMg * substance.bioavailability;
  const minute = Math.max(0, Math.min(DAY.minutes, Math.floor(t)));
  const mgL = track.series[minute];
  const level = shareOf(mgL, track.series.reduce((a, b) => Math.max(a, b), 0));
  const name = inSentence(substance.label);
  const ledger = (at: number): DoseLedger => {
    const found = substanceLedgerAt(tr, substance.id, at);
    if (!found) throw new Error(`No ledger for substance ${substance.id}`);
    return { stomach: 0, intestine: found.gut, blood: found.body, cleared: found.cleared, dose: available };
  };
  const effects = (): Draft[] =>
    substance.targets.map((target, i) => ({
      id: `target-${i}`,
      organ: target.organ,
      label: startCase(target.organ.replace("_", " ")),
      reading: `${mgL.toFixed(1)} mg/L`,
      share: 0,
      flow: level,
      say: `${startCase(target.effect).replace(/\.$/, "")}.`,
      from: "blood",
      routes: TARGET_ROUTES[target.organ],
    }));
  return {
    id: `substance:${substance.id}`,
    title: `${way.verb} ${name}`,
    system: substance.targets.length ? TARGET_SYSTEM[substance.targets[0].organ] : "clearing",
    substance: "other",
    at: substance.at,
    ledger,
    fullRate: PROCESS.fullFlow.substanceMgPerMin,
    fullClearRate: PROCESS.fullFlow.substanceMgPerMin,
    entry: way.entry,
    effects,
    working: () => level >= PROCESS.finishedBelowShare,
    settlesAt: () => "blood",
    say: {
      stomach: null,
      intestine: (d) => (!d.started ? `You take the ${name} later.` : d.l.intestine >= available * PROCESS.presentShare ? `${mg(d.l.intestine)} is here, ${way.crossing}.` : "It has all crossed the gut wall."),
      blood: (d) => `${mg(d.l.blood)} is in your blood and tissues, ${mgL.toFixed(1)} mg/L. Half of it leaves every ${substance.halfLifeH} hours.`,
      cleared: (d) => `Your body has cleared ${mg(d.l.cleared)} so far, ${percent(shareOf(d.l.cleared, available))} of it.`,
    },
    clearedLabel: "Cleared",
    headline: {
      working: (d) => `${percent(shareOf(d.l.blood, available))} in your blood, ${mgL.toFixed(1)} mg/L`,
      done: (d) => `${percent(shareOf(d.l.cleared, available))} cleared`,
    },
  };
}

// ---- Lines that explain how the body works, whatever set them off.

function insulinProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName) => value(tr, name, t);
  const fold = v("insulin") / INSULIN.baselineUUPerMl;
  const mgDl = v("glucose");
  const mmol = (x: number) => (x / REFERENCE.mgDlPerMmolGlucose).toFixed(1);
  const posture = postureAt(tr, t);
  const rising = value(tr, "glucose", t + REFERENCE.trendWindowMin) - value(tr, "glucose", t - REFERENCE.trendWindowMin) > 1;
  const toMuscle = v("muscleUptakeGMin");
  const fromInsulin = v("insulinUptakeGMin") * GLUCOSE.muscleShare;
  const pulledByWork = toMuscle - fromInsulin;
  const toFat = v("insulinUptakeGMin") * GLUCOSE.fatShare;
  const toLiver = v("liverUptakeGMin");
  const leaving = toMuscle + toFat + toLiver;
  const movedByInsulin = fromInsulin + toFat + toLiver;
  const moving = posture === "walking" || posture === "running";
  const peak = peakAfter(tr, "glucose", t);
  const notableWork = pulledByWork * 60 >= PROCESS.sugarLeavingAboveGPerH;
  const gPerHour = (x: number) => `${Math.round(x * 60)} g/h`;
  const full = PROCESS.fullFlow.sugarGPerMin;
  const notable = (x: number) => x * 60 >= PROCESS.sugarLeavingAboveGPerH;
  const insulinUp = fold > REFERENCE.insulin.atRestBelowFold;
  // Working muscle pulls sugar in without insulin, so a walk alone leaves this line at rest.
  const active = fold > PROCESS.insulinActiveAboveFold || notable(movedByInsulin);

  const stops: Draft[] = [
    {
      id: "sugar",
      organ: "heart",
      label: "Blood sugar",
      reading: `${mmol(mgDl)} mmol/L`,
      share: clamp01((mgDl - tr.anthro.baselineGlucose) / PROCESS.sugarExcessFullMgDl),
      flow: flowRate(v("glucoseAbsorbMgMin") / 1000, full),
      say: active && peak.ahead && peak.value - mgDl >= 2 ? `Blood sugar is ${mmol(mgDl)} mmol/L, heading for ${mmol(peak.value)} near ${clock(peak.at)}. This rise starts the loop.` : `Blood sugar is ${mmol(mgDl)} mmol/L. Your body holds it near ${mmol(tr.anthro.baselineGlucose)}.`,
      routes: [],
    },
    {
      id: "pancreas",
      organ: "pancreas",
      label: "Pancreas",
      reading: `${fold.toFixed(1)}×`,
      share: clamp01((fold - 1) / (REFERENCE.insulin.afterFoodTypicalFold.high - 1)),
      flow: flowRate(v("insulinSecretion"), PROCESS.fullFlow.insulinSecretion),
      say: insulinUp ? `Your pancreas senses the sugar and releases insulin, now ${fold.toFixed(1)} times its resting level.` : "Your pancreas keeps a trickle of insulin going, waiting for sugar to rise.",
      routes: ["arch", "descending", "to_gut"],
    },
    {
      id: "liver",
      organ: "liver",
      label: "Liver",
      reading: gPerHour(toLiver),
      share: shareOf(toLiver, leaving),
      flow: flowRate(toLiver, full),
      say: notable(toLiver) ? `Insulin reaches your liver first. It stores ${gPerHour(toLiver)} of sugar and cuts its own release to ${gPerHour(v("hepaticOutputGMin"))}.` : `Your liver is releasing sugar, ${gPerHour(v("hepaticOutputGMin"))}, from ${Math.round(v("liverGlycogen"))} g of glycogen.`,
      routes: ["pancreas_portal"],
    },
    {
      id: "muscle",
      organ: "muscle",
      label: "Muscle",
      reading: gPerHour(toMuscle),
      share: shareOf(toMuscle, leaving),
      flow: flowRate(toMuscle, full),
      say: moving || notableWork ? `Moving muscles pull sugar in with little insulin, ${gPerHour(toMuscle)} right now.` : notable(toMuscle) ? `Insulin opens your muscles to sugar. They take ${gPerHour(toMuscle)}${posture === "sitting" ? " while you sit, far more if you walk" : ""}.` : "Your muscles are taking almost no sugar. Insulin or movement would open them.",
      from: "liver",
      routes: ["liver_out", "arch", "descending", "leg_L"],
    },
    {
      id: "fat",
      organ: "fat",
      label: "Fat tissue",
      reading: gPerHour(toFat),
      share: shareOf(toFat, leaving),
      flow: flowRate(toFat, full),
      say: insulinUp ? `Fat tissue takes a small share, ${gPerHour(toFat)}. Insulin also tells it to hold its fat.` : "With insulin at rest, your fat tissue releases a little fat for fuel.",
      from: "liver",
      routes: ["liver_out", "arch", "descending"],
    },
  ];

  let here: string | null = null;
  if (active) here = rising && fold < PROCESS.insulinStartingFold ? "pancreas" : toLiver >= toMuscle ? "liver" : "muscle";
  const headline = !active
    ? "Insulin is at rest. Your liver keeps your blood sugar steady"
    : rising
      ? `Insulin is ${fold.toFixed(1)}× rest and climbing, following your blood sugar`
      : `Insulin at ${fold.toFixed(1)}× is bringing sugar down, ${Math.round(fromInsulin * 60)} g/h into muscle, ${Math.round(toLiver * 60)} into liver`;
  return { id: "insulin", title: "Insulin", system: "energy", substance: "insulin", active, headline, stops: numbered(stops, here, "ahead", true) };
}

function fatTotals(tr: Trajectory, t: number) {
  const totals = { stomach: 0, gut: 0, blood: 0, cleared: 0, absorbingPerMin: 0, eaten: 0 };
  for (const intake of tr.scenario.intakes) {
    const flows = intakeFlowsAt(tr, intake.id, t);
    if (flows && hasStarted(intake.at, t)) {
      totals.stomach += flows.stomachFat;
      totals.gut += flows.gutFat;
      totals.blood += flows.bloodFat;
      totals.cleared += flows.fatCleared;
      totals.absorbingPerMin += flows.fatAbsorbedPerMin;
      totals.eaten += intake.fatG;
    }
  }
  return totals;
}

function fatRouteProcess(tr: Trajectory, t: number): Process {
  const fat = fatTotals(tr, t);
  const clearingPerMin = Math.max(0, (fatTotals(tr, t + PROCESS.flowWindowMin).cleared - fatTotals(tr, t - PROCESS.flowWindowMin).cleared) / (PROCESS.flowWindowMin * 2));
  const full = PROCESS.fullFlow.fatGPerMin;
  const tg = value(tr, "tg", t);
  const peak = peakAfter(tr, "tg", t, DAY.minutes);
  const grams = (x: number) => `${x >= 10 ? Math.round(x) : x.toFixed(1)} g`;
  const peaking = peak.ahead && peak.value - tg >= 3 ? `, heading for ${Math.round(peak.value)} near ${clock(peak.at)}` : "";
  const gPerHour = fat.absorbingPerMin * 60;

  const stops: Draft[] = [
    {
      id: "intestine",
      organ: "small_intestine",
      label: "Small intestine",
      reading: grams(fat.gut),
      share: shareOf(fat.gut, fat.eaten),
      flow: flowRate(fat.absorbingPerMin, full),
      say: fat.eaten > 0 ? `Fat needs bile and enzymes to cross the gut wall, so it moves slowly. ${grams(fat.gut)} here, ${grams(fat.stomach)} waiting in your stomach.` : "Fat needs bile and enzymes to cross the gut wall, so it moves slowly.",
      routes: ["stomach_out", "duodenum", "jejunum"],
    },
    {
      id: "lymph",
      organ: null,
      label: "Lymph",
      reading: `${gPerHour.toFixed(0)} g/h`,
      // Fat only passes through here, so the model keeps no amount at this stop.
      share: 0,
      flow: flowRate(fat.absorbingPerMin, full),
      say: "Fat is too big for gut blood vessels. It packs into droplets and rides the lymph up your chest.",
      routes: ["lymph"],
    },
    {
      id: "blood",
      organ: "heart",
      label: "Blood",
      reading: grams(fat.blood),
      share: shareOf(fat.blood, fat.eaten),
      flow: flowRate(fat.absorbingPerMin, full),
      say: `Lymph empties into a vein near your neck, so this fat misses the liver at first. Blood fat reads ${Math.round(tg)} mg/dL.`,
      routes: ["lymph_svc"],
    },
    {
      id: "fat",
      organ: "fat",
      label: "Fat tissue",
      reading: grams(fat.cleared),
      share: shareOf(fat.cleared, fat.eaten),
      flow: flowRate(clearingPerMin, full),
      say: fat.cleared >= 0.5 ? `Your fat tissue pulls it out of your blood. ${grams(fat.cleared)} so far, mostly stored, a little burned.` : "Your fat tissue pulls meal fat out of your blood and stores most of it.",
      routes: ["arch", "descending"],
    },
  ];

  const inTransit = fat.stomach + fat.gut + fat.blood;
  const active = fat.eaten > 0 && inTransit >= PROCESS.fatRouteActiveAboveG;
  let here: string | null = null;
  if (active) {
    if (fat.stomach + fat.gut < fat.blood) here = fat.blood >= fat.cleared ? "blood" : "fat";
    else here = "intestine";
  }
  const headline =
    fat.eaten === 0
      ? "No fat eaten yet"
      : !active
        ? `${grams(fat.cleared)} of ${grams(fat.eaten)} has left your blood`
        : fat.stomach >= fat.eaten * 0.5
          ? `${grams(fat.stomach)} of ${grams(fat.eaten)} still in your stomach, reaching your blood hours after the sugar`
          : `${grams(fat.blood)} in your blood${peaking}`;
  return { id: "fat-route", title: "Fat route", system: "energy", substance: "fat", active, headline, stops: numbered(stops, here, fat.eaten > 0 ? "passed" : "ahead") };
}

interface BloodBranch {
  id: string;
  organ: OrganId;
  label: string;
  series: SeriesName;
  routes: RouteId[];
  note: (ctx: { moving: boolean; digesting: boolean }) => string;
}

const BLOOD_BRANCHES: BloodBranch[] = [
  { id: "gut", organ: "small_intestine", label: "Gut", series: "flowGut", routes: ["arch", "descending", "to_gut"], note: ({ moving, digesting }) => (moving ? `Down from ${percent(BLOOD_FLOW.rest.gut)} at rest, because working muscle takes the blood.` : digesting ? `Up from ${percent(BLOOD_FLOW.rest.gut)} at rest, to carry away what you absorb.` : "Its usual share at rest.") },
  { id: "muscle", organ: "muscle", label: "Muscle", series: "flowMuscle", routes: ["arch", "descending", "leg_L", "leg_R"], note: ({ moving }) => (moving ? "Working muscles open their vessels wide." : "Resting muscle needs little.") },
  { id: "brain", organ: "brain", label: "Brain", series: "flowBrain", routes: ["arch", "carotid"], note: () => "Your brain's supply barely changes." },
  { id: "kidneys", organ: "kidneys", label: "Kidneys", series: "flowKidneys", routes: ["arch", "descending", "to_kidney_L", "to_kidney_R"], note: () => "They filter it and send waste to your bladder." },
];

function circulationProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName) => value(tr, name, t);
  const bpm = v("hr");
  const output = v("cardiacOutput");
  const posture = postureAt(tr, t);
  const moving = posture === "walking" || posture === "running";
  const digesting = v("digestion") > 0.05;
  const stops: Draft[] = [
    {
      id: "heart",
      organ: "heart",
      label: "Heart",
      reading: `${Math.round(bpm)} bpm`,
      share: 1,
      flow: flowRate(output, PROCESS.fullFlow.heartLPerMin),
      say: `Your heart beats ${Math.round(bpm)} times a minute and moves ${output.toFixed(1)} L of blood, shared out by need.`,
      routes: [],
    },
    ...BLOOD_BRANCHES.map((branch) => ({
      id: branch.id,
      organ: branch.organ,
      label: branch.label,
      reading: percent(v(branch.series)),
      share: v(branch.series),
      flow: flowRate(v(branch.series) * output, PROCESS.fullFlow.bloodLPerMin),
      say: `${percent(v(branch.series))} of your blood, ${(v(branch.series) * output).toFixed(1)} L a minute. ${branch.note({ moving, digesting })}`,
      from: "heart",
      routes: branch.routes,
    })),
  ];
  const here = moving ? "muscle" : digesting ? "gut" : "heart";
  const headline = moving ? `${percent(v("flowMuscle"))} of your blood is going to your muscles` : digesting ? `${percent(v("flowGut"))} of your blood is going to your gut, up from ${percent(BLOOD_FLOW.rest.gut)} at rest` : `Your heart moves ${output.toFixed(1)} L a minute, shared out the usual way`;
  return { id: "circulation", title: "Blood flow", system: "circulation", substance: "other", active: true, headline, stops: numbered(stops, here, "ahead", true) };
}

function alertnessProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName) => value(tr, name, t);
  const occupancy = v("occupancy");
  const mgL = v("caffeine");
  const totals = caffeineTotals(tr, t);
  const before = caffeineTotals(tr, t - PROCESS.flowWindowMin);
  const after = caffeineTotals(tr, t + PROCESS.flowWindowMin);
  const absorbingPerMin = (after.blood + after.cleared - before.blood - before.cleared) / (PROCESS.flowWindowMin * 2);
  const awake = hoursWord(v("hoursAwake"));
  const alertWord = levelWord(v("alertness")).toLowerCase();
  const asleep = postureAt(tr, t) === "sleeping";
  const felt = v("caffeineFelt");
  const working = felt >= PROCESS.caffeineWorkingAboveFelt;
  const blocked = Math.round(occupancy * 100);
  const drains = v("mealDip") >= PROCESS.mealPullsAlertnessAbove ? "the meal and time awake pull it down" : "time awake pulls it down";

  const stops: Draft[] = [
    {
      id: "caffeine",
      organ: "heart",
      label: "Caffeine in blood",
      reading: `${mgL.toFixed(2)} mg/L`,
      share: shareOf(totals.blood, totals.dose),
      flow: flowRate(absorbingPerMin, PROCESS.fullFlow.caffeineMgPerMin),
      say: totals.dose > 0 ? `${mg(totals.blood)} of ${mg(totals.dose)} is still in your blood. Caffeine passes easily into your brain.` : "No caffeine logged.",
      routes: ["liver_out", "arch"],
    },
    {
      id: "receptors",
      organ: "brain",
      label: "Tired signal blocked",
      reading: `${blocked}%`,
      share: occupancy,
      flow: felt,
      say: working ? `Caffeine sits where the tired signal would land, stopping ${blocked} of every 100. That hides some of your tiredness.` : "Almost none of the tired signal is blocked, so it lands freely.",
      routes: ["carotid"],
    },
    {
      id: "alertness",
      organ: "brain",
      label: "Alertness",
      reading: levelWord(v("alertness")),
      share: v("alertness"),
      flow: 0,
      say: asleep ? "You are asleep." : `Your alertness is ${alertWord}. ${working ? `Caffeine holds it up, ${drains}.` : `${startCase(drains)}.`}`,
      routes: [],
    },
    {
      id: "pressure",
      organ: "brain",
      label: "Sleep pressure",
      reading: asleep ? "" : `${awake} awake`,
      share: clamp01(v("sleepPressure") / (PROCESS.sleepPressureFullH * FEEL.sleepPressurePerHour)),
      flow: 0,
      say: asleep ? "Sleep clears the adenosine you built up during the day." : working ? `Adenosine has built for ${awake}. Caffeine hides it, so you feel it all when caffeine wears off.` : `Adenosine has built for ${awake}. You feel it as tiredness.`,
      routes: [],
    },
  ];
  const headline = asleep ? "Asleep, and clearing the day's tiredness" : working ? `Caffeine hides some of your tiredness after ${awake} awake` : `No caffeine at work, tiredness building after ${awake} awake`;
  return { id: "alertness", title: "Alertness", system: "brain", substance: "caffeine", active: working, headline, stops: numbered(stops, working ? "caffeine" : null, "ahead", true) };
}

function clearingProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName, at = t) => value(tr, name, at);
  const totals = caffeineTotals(tr, t);
  const caffeinePerHour = totals.blood * (Math.LN2 / caffeineHalfLifeH(tr));
  const caffeine = v("caffeine");
  const alcohol = v("alcohol");
  const bladder = v("bladderMl");
  const change = (v("bladderMl", t + 5) - v("bladderMl", t - 5)) / 10;
  const urinePerMin = change > 0 ? change : KIDNEY.urineMlPerMin;
  const hasAlcohol = alcohol >= PROCESS.clearingActiveAboveGPerL;
  const hasCaffeine = caffeine >= PROCESS.clearingActiveAboveMgL;
  const minute = Math.max(0, Math.min(DAY.minutes, Math.floor(t)));
  const substances = [...tr.substances.values()].filter(({ substance, series }) => hasStarted(substance.at, t) && series[minute] >= PROCESS.clearingActiveAboveMgL);
  const full = PROCESS.fullFlow;
  const ml = `${Math.round(bladder / 10) * 10} ml`;
  const urine = `${Math.round(urinePerMin * 60)} ml`;

  const stops: Draft[] = [
    {
      id: "liver",
      organ: "liver",
      label: "Liver",
      reading: hasAlcohol ? `${alcohol.toFixed(2)} g/L` : hasCaffeine ? `${caffeinePerHour.toFixed(1)} mg/h` : "Quiet",
      share: shareOf(totals.cleared, totals.dose),
      flow: hasAlcohol ? flowRate((ALCOHOL.eliminationGPerLPerH * alcoholVolumeL(tr.scenario.body)) / 60, full.alcoholGPerMin) : flowRate(caffeinePerHour / 60, full.clearedMgPerMin),
      say: hasAlcohol ? `Your liver is clearing alcohol first, ${alcohol.toFixed(2)} g/L left.` : hasCaffeine ? `Your liver clears about ${caffeinePerHour.toFixed(1)} mg of caffeine an hour, ${caffeine.toFixed(2)} mg/L left.` : "Your liver has little to clear right now.",
      routes: ["to_liver_art"],
    },
    {
      id: "kidneys",
      organ: "kidneys",
      label: "Kidneys",
      reading: `${urine}/h`,
      share: v("flowKidneys"),
      flow: flowRate(urinePerMin, full.urineMlPerMin),
      say: `Your kidneys receive ${percent(v("flowKidneys"))} of your blood, filter it, and make about ${urine} of urine an hour.`,
      from: "liver",
      routes: ["liver_out", "arch", "descending", "to_kidney_L", "to_kidney_R"],
    },
    {
      id: "bladder",
      organ: "bladder",
      label: "Bladder",
      reading: ml,
      share: clamp01(bladder / REFERENCE.bladder.capacityMl),
      flow: flowRate(urinePerMin, full.urineMlPerMin),
      say: `Your bladder holds ${ml}. You notice it near ${REFERENCE.bladder.firstDesireMl} ml, urgent near ${REFERENCE.bladder.strongDesireMl} ml.`,
      routes: ["to_bladder_L", "to_bladder_R"],
    },
  ];
  const liverBusy = hasAlcohol || hasCaffeine || substances.length > 0;
  const active = liverBusy || bladder >= REFERENCE.bladder.firstDesireMl;
  const here = !active ? null : liverBusy ? "liver" : "bladder";
  const headline = hasAlcohol
    ? `Your liver is clearing alcohol, ${alcohol.toFixed(2)} g/L left. Your bladder holds ${ml}`
    : hasCaffeine
      ? `Your liver clears ${caffeinePerHour.toFixed(1)} mg of caffeine an hour. Your bladder holds ${ml}`
      : substances.length
        ? `Your body is clearing ${inSentence(substances[0].substance.label)}. Your bladder holds ${ml}`
        : `Nothing much to clear. Your bladder holds ${ml}`;
  return { id: "clearing", title: "Liver and kidneys", system: "clearing", substance: "other", active, headline, stops: numbered(stops, here, "ahead", true) };
}

// ---- Anything else that happened, told through its own stops.

const CHANNEL_TEXT: Record<ChannelId, (x: number) => string> = {
  heartRate: (x) => `${signed(x)} bpm`,
  breathing: (x) => `${signed(x)}/min`,
  temperature: (x) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} °C`,
  bloodPressure: (x) => `${signed(x)} mmHg`,
  stress: ofHundred,
  reward: ofHundred,
  drowsiness: ofHundred,
  inflammation: ofHundred,
  immune: ofHundred,
  metabolism: percentChange,
  insulinSensitivity: percentChange,
  liverOutput: percentChange,
  appetite: percentChange,
  fluidLoss: (x) => `${x.toFixed(1)} ml/min`,
  muscleFlow: percentChange,
};

function signed(x: number) {
  return `${x >= 0 ? "+" : ""}${Math.round(x)}`;
}

function percentChange(x: number) {
  return `${signed(x * 100)}%`;
}

function ofHundred(x: number) {
  return levelWord(x);
}

function eventHeadline(event: ResolvedEvent, t: number): string {
  const end = event.ends;
  const running = end === null || t <= end;
  const heart = Math.round(effectAt(event, "heartRate", t));
  switch (event.preset) {
    case "training": {
      const named = namesOf(event.muscles);
      if (running) return `Working your ${named}, heart up ${heart} bpm`;
      const peak = (end ?? t) + PROCESS.sorenessPeakMin;
      return t < peak ? `Repairing your ${named}, soreness peaks ${whenWords(peak, t)}` : `Your ${named} are healing, soreness easing`;
    }
    case "illness": {
      const fever = effectAt(event, "temperature", t);
      if (!running) return "Recovering, and insulin stays less effective for days";
      return fever >= PROCESS.feverNamedFromC ? `Immune system fighting it, temperature up ${fever.toFixed(1)} °C` : "Immune system fighting it, no fever";
    }
    case "sex":
      return running ? `Heart up about ${heart} bpm, pressure raised` : "Heart rate back near baseline, prolactin stays raised";
    case "stress":
      return running ? `Stress hormones up, heart up ${heart} bpm` : `Easing off, heart still up ${heart} bpm`;
    case "poor_sleep":
      return `Insulin works ${Math.round(-effectAt(event, "insulinSensitivity", t) * 100)}% less, hunger up ${Math.round(effectAt(event, "appetite", t) * 100)}%`;
    case "custom":
      return running ? "Claude's estimate, still going on" : "Claude's estimate, fading";
    default: {
      const exhaustive: never = event.preset;
      return exhaustive;
    }
  }
}

function eventStop(event: ResolvedEvent, stop: EventStop, index: number, here: number, t: number, level: number): Draft {
  const elapsed = t - event.from;
  const isHere = index === here;
  const reached = stop.afterMin <= elapsed;
  let share = reached ? level : 0;
  let reading = stop.word ?? "";
  if (stop.shows !== undefined && reached) {
    if (isMuscleState(stop.shows)) {
      const group = stop.muscle ?? event.muscles[0]?.group;
      const work = event.muscles.find((m) => m.group === group);
      const state = work && event.ends !== null ? muscleStateFromEvent(event, event.ends, work.load, t)[stop.shows] : 0;
      share = state;
      reading = levelWord(state);
    } else {
      const amount = effectAt(event, stop.shows, t);
      const full = event.effects.reduce((sum, e) => (e.channel === stop.shows ? sum + Math.abs(e.amount) : sum), 0);
      share = shareOf(Math.abs(amount), full);
      reading = CHANNEL_TEXT[stop.shows](amount);
    }
    // A number that has already run its course says nothing worth reading.
    if (!isHere && share < PROCESS.stopFadedBelowShare) reading = "";
  }
  return {
    id: `stop-${index}`,
    organ: stop.organ,
    muscle: stop.muscle,
    label: stop.label,
    reading,
    share,
    flow: isHere ? Math.max(PROCESS.eventLineLeastFlow, level) : 0,
    say: stop.say,
    from: stop.branchOf === undefined ? undefined : `stop-${stop.branchOf}`,
    routes: stop.routes,
  };
}

function eventProcess(event: ResolvedEvent, t: number): Process {
  const started = hasStarted(event.from, t);
  const active = started && eventActiveAt(event, t);
  const here = active ? Math.max(0, currentStopIndex(event, t)) : -1;
  const level = eventLevelAt(event, t);
  const drafts = event.stops.map((stop, index) => eventStop(event, stop, index, here, t, level));
  return {
    id: `event:${event.id}`,
    title: event.label,
    system: event.systems[0],
    alsoIn: event.systems.slice(1),
    substance: event.substance,
    active,
    headline: !started ? `Logged for ${clock(event.from)}` : active ? eventHeadline(event, t) : "Over",
    stops: numbered(drafts, here >= 0 ? `stop-${here}` : null, started ? "passed" : "ahead", event.liveStops),
  };
}

// Each builder adds the lines it knows about. A new kind of thing happening to the body is a new
// entry here, and none of them may assume another has anything to show.
type ProcessBuilder = (tr: Trajectory, t: number) => Process[];

const newestFirst = (tr: Trajectory) => [...tr.scenario.intakes].sort((a, b) => b.at - a.at);

const QUIET_FLOW = 0.15;

// The hormones' loop, from the brain down to the uterus. It only exists once a cycle has been logged.
function cycleProcess(tr: Trajectory, t: number): Process[] {
  const { cycle } = tr;
  if (!cycle) return [];
  const v = (name: SeriesName) => value(tr, name, t);
  const phase = cyclePhase(cycle, t);
  const stops: Draft[] = [
    {
      id: "pituitary",
      organ: "brain",
      label: "Pituitary",
      reading: `${Math.round(v("lh"))} IU/L LH`,
      share: Math.min(1, v("lh") / (CYCLE.hormones.lh.base + CYCLE.hormones.lh.surge.amount)),
      flow: phase === "ovulation" ? 1 : QUIET_FLOW,
      say: phase === "ovulation" ? "A surge of LH from the base of the brain tells the ripest follicle to release its egg." : "The base of the brain keeps releasing a little LH and FSH, which tell the ovaries what to do.",
      routes: [],
    },
    {
      id: "ovaries",
      organ: "ovaries",
      label: "Ovaries",
      reading: phase === "luteal" ? `${v("progesterone").toFixed(1)} nmol/L progesterone` : `${Math.round(v("estradiol"))} pmol/L estrogen`,
      share: lutealShare(cycle, t),
      flow: phase === "period" ? QUIET_FLOW : 0.6,
      say: phase === "luteal" ? "The follicle that released the egg now makes progesterone, which warms the body a little." : "A growing follicle makes estrogen, which rebuilds the lining of the uterus.",
      routes: ["from_brain", "descending"],
    },
    {
      id: "uterus",
      organ: "uterus",
      label: "Uterus",
      reading: `Day ${cycleDay(cycle, t)}`,
      share: liningShare(cycle, t),
      flow: phase === "period" ? 0.8 : 0.4,
      say: phase === "period" ? "With progesterone gone, the lining sheds. That is the period." : phase === "luteal" ? "Progesterone keeps the lining ready. If no pregnancy starts, it falls and the lining sheds." : "Estrogen is thickening the lining again.",
      routes: [],
    },
  ];
  const here = phase === "period" ? "uterus" : phase === "ovulation" ? "pituitary" : "ovaries";
  const headline = `Day ${cycleDay(cycle, t)} of ${cycle.lengthDays}: ${{ period: "your period", follicular: "the follicular phase", ovulation: "around ovulation", luteal: "the luteal phase" }[phase]}`;
  return [{ id: "cycle", title: "Menstrual cycle", system: "reproductive", substance: "other", active: true, headline, stops: numbered(stops, here, "ahead", true) }];
}

// What a process Claude added gets to read: the model's curves and what was logged, and nothing it can change.
export function viewOf(tr: Trajectory): BodyView {
  return {
    body: tr.scenario.body,
    restingBpm: tr.anthro.restingBpm,
    value: (name, minute) => value(tr, name, minute),
    events: tr.events.map((event) => ({ label: event.label, preset: event.preset, from: event.from, until: event.until })),
  };
}

const broken = new Set<string>();

// A process Claude added runs through its tests before it gets here. One that still fails on a real day
// goes quiet rather than taking the page down, and says so once.
function extensionLines(tr: Trajectory, t: number): Process[] {
  const view = viewOf(tr);
  return EXTENSIONS.flatMap((extension) => {
    try {
      const { active, headline, here, stops } = extension.at(view, t);
      return [{ id: `ext:${extension.id}`, title: extension.title, system: extension.system, substance: "other" as const, active, headline, stops: numbered(stops, here, "ahead", true) }];
    } catch (e: unknown) {
      if (!broken.has(extension.id)) console.error(`The process ${extension.id} failed`, e);
      broken.add(extension.id);
      return [];
    }
  });
}

// What came over from yesterday is only worth a line while it is still doing something.
const stillHere = (from: number, line: Process) => (from >= 0 || line.active ? [line] : []);

const PROCESS_BUILDERS: ProcessBuilder[] = [
  (tr, t) => mealGroups(tr.scenario.intakes).reverse().flatMap((group) => stillHere(group[0].at, foodProcess(tr, group, t))),
  (tr, t) =>
    newestFirst(tr)
      .filter((intake) => intake.caffeineMg > 0)
      .flatMap((intake) => stillHere(intake.at, doseProcess(caffeineLine(tr, intake, t), t))),
  (tr, t) => [insulinProcess(tr, t)],
  (tr, t) => [fatRouteProcess(tr, t)],
  (tr, t) => [circulationProcess(tr, t)],
  (tr, t) => [alertnessProcess(tr, t)],
  (tr, t) => [clearingProcess(tr, t)],
  (tr, t) => cycleProcess(tr, t),
  (tr, t) => extensionLines(tr, t),
  (tr, t) =>
    newestFirst(tr)
      .filter((intake) => intake.alcoholG > 0)
      .flatMap((intake) => stillHere(intake.at, doseProcess(alcoholLine(tr, intake, t), t))),
  (tr, t) => tr.scenario.substances.flatMap((substance) => stillHere(substance.at, doseProcess(substanceLine(tr, substance, t), t))),
  (tr, t) => [...tr.events].sort((a, b) => b.from - a.from).map((event) => eventProcess(event, t)),
];

export function processesAt(tr: Trajectory, t: number): Process[] {
  return PROCESS_BUILDERS.flatMap((build) => build(tr, t));
}

// The id a selected process has now. A food's id changes when it joins or leaves a meal, and anything
// removed has no line left to show.
export function followProcess(tr: Trajectory, id: string, t: number): string | null {
  if (processesAt(tr, t).some((p) => p.id === id)) return id;
  const food = /^(?:intake|meal):(.+)$/.exec(id)?.[1];
  const group = food === undefined ? undefined : mealGroups(tr.scenario.intakes).find((g) => g.some((intake) => intake.id === food));
  return group ? mealProcessId(group) : null;
}

export function processesFor(tr: Trajectory, t: number, system: SystemId): Process[] {
  return processesAt(tr, t).filter((p) => system === "overview" || p.system === system || (p.alsoIn ?? []).includes(system));
}
