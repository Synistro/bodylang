import { ALCOHOL, DAY, PROCESS, REFERENCE } from "../params";
import { alcoholLedgerAt, caffeineLedgerAt, substanceLedgerAt, Trajectory, value } from "../engine/trajectory";
import { CustomSubstance, SubstanceRoute, Intake } from "../scenario";
import { OrganId } from "../ids";
import { inSentence, startCase } from "../words";
import type { SystemId, RouteId, Substance } from "../ids";
import { clamp01 } from "../curve";
import { Draft, Process, clock, flowRate, hasFoodLine, hasStarted, numbered, percent, shareOf } from "./line";

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

export function doseProcess(line: DoseLine, t: number): Process {
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

export function caffeineTotals(tr: Trajectory, t: number) {
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

export const caffeineHalfLifeH = (tr: Trajectory) => tr.anthro.caffeineHalfLifeH;
export const mg = (x: number) => `${Math.round(x)} mg`;

export function caffeineLine(tr: Trajectory, intake: Intake, t: number): DoseLine {
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

export function alcoholLine(tr: Trajectory, intake: Intake, t: number): DoseLine {
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

export function substanceLine(tr: Trajectory, substance: CustomSubstance, t: number): DoseLine {
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
