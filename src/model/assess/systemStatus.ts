import { effectAt } from "../events/curves";
import { muscleStateAt, namesOf } from "../events/muscles";
import { MuscleWork } from "../events/types";
import { MUSCLE_GROUPS } from "../muscleGroups";
import { CAFFEINE, CYCLE, DAY, FEELING_DISPLAY, LIPID, PROCESS, REFERENCE, STOMACH } from "../params";
import { SystemId } from "../ids";
import { forecast as stateForecast } from "../forecast";
import { inSentence } from "../words";
import { systemById } from "../systems";
import type { ReadingId } from "../ids";
import { clamp01 } from "../curve";
import { Context, POSTURE_WORD, always, clock, eventHeartBpm, fromMoving, heartCauses, ownRestBpm, peakAhead, tens, toMmol, minutesUntilSleep, sorenessPeak, muscleLevel, groupsWhere, anyMuscle } from "./context";
import { PHASE_SAYS, PHASE_WORD, phaseOf } from "./readings/wholeBody";
import { Reading, SystemStatus, Tone } from "./types";

export const TONE_RANK: Record<Tone, number> = { calm: 0, note: 1, concern: 2 };

function worstTone(tones: Tone[]): Tone {
  return tones.reduce<Tone>((worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst), "calm");
}

type WordRow = readonly [test: (c: Context, reading: (id: ReadingId) => Reading) => boolean, word: string | ((c: Context) => string)];
type Says = (c: Context, reading: (id: ReadingId) => Reading) => string;
// One row holds a word and its sentence, so the two can never say different things.
type StatusRow = readonly [...WordRow, Says];

interface SystemSpec {
  rows: readonly StatusRow[]; // the first row that passes speaks. The last always passes, and means nothing is going on
  level: (c: Context, reading: (id: ReadingId) => Reading) => number;
}

function activeSubstance(c: Context) {
  const minute = Math.max(0, Math.min(DAY.minutes, Math.floor(c.t)));
  return [...c.tr.substances.values()].find(({ substance, series }) => substance.at <= c.t && series[minute] > 0.01);
}

const OVERVIEW_WORDS: readonly WordRow[] = [
  [(c) => c.asleep, "Asleep"],
  [(c) => c.training !== null, "Training"],
  [(c) => c.moving, (c) => POSTURE_WORD[c.posture]],
  [(c) => c.v("digestion") >= REFERENCE.digestion.finishingFrom, "Digesting"],
  [(c) => c.events.some((e) => e.preset === "illness" && e.ends === null), "Unwell"],
  [always, "Resting"],
];

// The groups in a given state right now, however many sessions put them there, busiest first.

const hasFever = (c: Context) => c.v("temperature") >= REFERENCE.temperature.feverC && !c.moving && c.training === null;
const fighting = (c: Context) => c.events.find((e) => e.ends === null && effectAt(e, "immune", c.t) >= REFERENCE.immune.high / 100) ?? null;
// A hard session raises stress hormones too, and nobody would call that being stressed.
const stressedNow = (c: Context) => c.v("stressLevel") >= REFERENCE.stressLevel.high / 100 && !c.exerting;
const lowFuel = (c: Context) => c.v("liverGlycogen") < REFERENCE.liverGlycogen.low;
const isDry = (c: Context) => c.v("fluidBalance") <= -c.tr.scenario.body.weightKg * REFERENCE.fluid.noticeableShareOfWeight * 1000;
const mmolText = (c: Context) => toMmol(c.v("glucose")).toFixed(1);

function digestionSentence(c: Context): string {
  const empties = stateForecast(c.tr, c.t).stomachEmpty;
  if (c.v("stomachKcal") > REFERENCE.stillDigestingKcal) return `Your stomach holds ${tens(c.v("stomachMl"))} ml${empties === null ? "" : ` and empties near ${clock(empties)}`}.`;
  if (c.v("digestion") >= REFERENCE.digestion.finishingFrom) return "Your intestine is absorbing the last of the meal.";
  return c.v("stomachMl") > STOMACH.restingVolumeMl + REFERENCE.stomach.emptyAboveRestingMl ? "Liquid is passing through your stomach." : "Your stomach and gut are resting.";
}

function sugarRisingSentence(c: Context): string {
  const peak = peakAhead(c, "glucose", 2);
  return peak ? `Blood sugar is ${mmolText(c)} and rising, peaking at ${toMmol(peak.value).toFixed(1)} near ${clock(peak.at)}.` : `Blood sugar is ${mmolText(c)} and rising.`;
}

function heartSentence(c: Context): string {
  const bpm = Math.round(c.v("hr"));
  const breaths = Math.round(c.v("breaths"));
  if (c.moving || c.exerting) return `Your heart is at ${bpm} bpm and you breathe ${breaths} times a minute.`;
  const [first] = heartCauses(c);
  if (first && first.bpm >= REFERENCE.heart.raisedAboveOwnRestBpm) return `Your heart is at ${bpm} bpm; ${first.name} adds about ${Math.round(first.bpm)}.`;
  return c.asleep ? `Your heart has slowed to ${bpm} bpm for sleep.` : "Your heart and breathing are at their usual resting pace.";
}

// "Your chest is" and "your quads are": only these two groups read as singular.
const yourMuscles = (groups: MuscleWork[]) => `Your ${namesOf(groups)} ${groups.length === 1 && (groups[0].group === "chest" || groups[0].group === "back") ? "is" : "are"}`;

function muscleSentence(c: Context): string {
  const r = REFERENCE.muscleState;
  const peak = sorenessPeak(c);
  const working = groupsWhere(c, (s) => s.work >= r.workingFrom);
  if (working.length) return `${yourMuscles(working)} working.`;
  const sore = groupsWhere(c, (s) => s.soreness >= r.soreFrom);
  if (sore.length) return peak ? `${yourMuscles(sore)} sore. Soreness ${peak.toLowerCase()}.` : `${yourMuscles(sore)} sore, and it is easing.`;
  const repairing = groupsWhere(c, (s) => s.fatigue >= r.tiredFrom || s.repair >= r.repairingFrom);
  if (repairing.length) return peak ? `${yourMuscles(repairing)} repairing. Soreness ${peak.toLowerCase()}.` : `${yourMuscles(repairing)} repairing.`;
  return "Your muscles are rested.";
}

function sleepySentence(c: Context): string {
  const sleepiest = peakAhead(c, "drowsy", 0.02, FEELING_DISPLAY.peakHorizonMin);
  return sleepiest && sleepiest.at <= minutesUntilSleep(c) ? `You may feel sleepy, most near ${clock(sleepiest.at)}.` : "You may feel sleepy.";
}

const caffeineSentence = (c: Context, r: (id: ReadingId) => Reading) => `Caffeine is ${r("caffeine").trend === "rising" ? "kicking in" : "fading"}, with ${Math.round(c.v("occupancy") * 100)}% of the tired signal blocked.`;

function immuneSentence(c: Context): string {
  const illness = fighting(c);
  if (illness) {
    const day = Math.floor((c.t - illness.from) / 1440) + 1;
    const site = illness.stops[0];
    const where = site && site.organ !== "spleen" ? `, in your ${site.label.toLowerCase()}` : "";
    return `${illness.label}, day ${day}${where}${hasFever(c) ? `, temperature ${c.v("temperature").toFixed(1)}` : ""}.`;
  }
  return c.v("immune") >= REFERENCE.immune.high / 100 ? "Your immune system is winding down." : "Nothing to fight right now.";
}

const SYSTEM_STATUS: Record<Exclude<SystemId, "overview">, SystemSpec> = {
  digestion: {
    rows: [
      [(c) => c.v("digestion") >= REFERENCE.digestion.workingHardFrom, "Working hard", digestionSentence],
      [(c) => c.v("digestion") >= REFERENCE.digestion.workingFrom || c.v("stomachKcal") > REFERENCE.stillDigestingKcal, "Working", digestionSentence],
      [(c) => c.v("digestion") >= REFERENCE.digestion.finishingFrom, "Finishing", digestionSentence],
      [always, "Quiet", digestionSentence],
    ],
    level: (c) => c.v("digestion"),
  },
  energy: {
    rows: [
      [(_c, r) => r("glucose").verdict === "low", "Sugar low", (c) => `Blood sugar is low at ${mmolText(c)}.`],
      [(c) => lowFuel(c), "Liver fuel low", (c) => `Liver fuel is low at ${Math.round(c.v("liverGlycogen"))} g, and blood sugar is ${mmolText(c)}.`],
      [(_c, r) => r("glucose").trend === "rising", "Rising", sugarRisingSentence],
      [(_c, r) => r("glucose").trend === "falling", "Falling", (c) => `Blood sugar is ${mmolText(c)} and coming down.`],
      [(c) => c.v("tg") - c.tr.anthro.baselineTg >= REFERENCE.triglycerides.arrivedAboveRestMgDl, "Clearing fat", (c) => `Blood fat is ${Math.round(c.v("tg"))} mg/dL and clearing.`],
      [always, "Steady", (c) => `Blood sugar is steady at ${mmolText(c)}.`],
    ],
    level: (c, r) => Math.max((r("insulin").value - 1) / REFERENCE.systemFullAt.insulinFold, (c.v("tg") - c.tr.anthro.baselineTg) / LIPID.baselineMgDl, c.v("muscleUptakeGMin") / REFERENCE.systemFullAt.muscleUptakeGPerMin),
  },
  circulation: {
    rows: [
      [(c) => c.moving || c.exerting, "Working", heartSentence],
      [(_c, r) => r("hr").verdict === "high", "Heart high", heartSentence],
      [(c) => c.v("systolic") >= REFERENCE.bloodPressure.raised, "Pressure up", heartSentence],
      [(c) => !c.moving && fromMoving(c, "heartRate") >= REFERENCE.heart.raisedAboveOwnRestBpm, "Recovering", heartSentence],
      [(c, r) => r("hr").verdict === "raised" || eventHeartBpm(c) >= REFERENCE.heart.raisedAboveOwnRestBpm, "Raised", heartSentence],
      [always, "Steady", heartSentence],
    ],
    level: (c) => (c.v("hr") - ownRestBpm(c, "sitting")) / REFERENCE.systemFullAt.heartBpm,
  },
  muscles: {
    rows: [
      [(c) => anyMuscle(c, (s) => s.work >= REFERENCE.muscleState.workingFrom), "Working", muscleSentence],
      [(c) => anyMuscle(c, (s) => s.soreness >= REFERENCE.muscleState.soreFrom), "Sore", muscleSentence],
      [(c) => anyMuscle(c, (s) => s.fatigue >= REFERENCE.muscleState.tiredFrom), "Tired", muscleSentence],
      [(c) => anyMuscle(c, (s) => s.repair >= REFERENCE.muscleState.repairingFrom), "Repairing", muscleSentence],
      [always, "Quiet", muscleSentence],
    ],
    level: (c) => MUSCLE_GROUPS.reduce((most, group) => Math.max(most, muscleLevel(muscleStateAt(c.tr.muscleEvents, group, c.t))), 0),
  },
  brain: {
    rows: [
      [(c) => c.asleep, "Asleep", () => "You are asleep, and sleep is clearing the day's tiredness."],
      [(c) => c.v("jitter") >= FEELING_DISPLAY.negligibleBelow, "Jittery", () => "Lots of caffeine, so you may feel jittery."],
      [(c) => c.v("alcohol") >= REFERENCE.alcohol.slowsBrainFromGPerL, "Alcohol", (c) => `Alcohol is slowing your brain, ${c.v("alcohol").toFixed(2)} g/L in your blood.`],
      [stressedNow, "Stressed", () => "Stress hormones are keeping your brain on alert."],
      [(c) => c.v("drowsy") >= PROCESS.sleepyNamedFrom, "Drowsy", sleepySentence],
      [(c) => c.v("reward") >= PROCESS.liftedFrom, "Lifted", () => "Feel-good chemicals are up."],
      [(c, r) => c.v("caffeineFelt") >= PROCESS.caffeineWorkingAboveFelt && r("caffeine").trend === "rising", "Caffeine rising", caffeineSentence],
      [(c) => c.v("caffeineFelt") >= PROCESS.caffeineWorkingAboveFelt, "Caffeine fading", caffeineSentence],
      [always, "Clear", () => "Your brain is clear, with no caffeine at work."],
    ],
    level: (c) => Math.max(c.v("caffeineFelt"), c.v("drowsy"), c.v("stressLevel"), c.v("reward")),
  },
  immune: {
    rows: [
      [hasFever, (c) => `Fever ${c.v("temperature").toFixed(1)}`, immuneSentence],
      [(c) => fighting(c) !== null, "Fighting it", immuneSentence],
      [(c) => c.v("immune") >= REFERENCE.immune.high / 100, "Recovering", immuneSentence],
      [always, "Quiet", immuneSentence],
    ],
    level: (c) => c.v("immune"),
  },
  clearing: {
    rows: [
      [(c) => c.v("alcohol") >= REFERENCE.alcohol.clearingNamedFromGPerL, "Clearing alcohol", (c) => `Your liver is clearing alcohol, ${c.v("alcohol").toFixed(2)} g/L left.`],
      [isDry, "A little dry", (c) => `You are a little dry, down about ${(-c.v("fluidBalance") / 1000).toFixed(1)} L.`],
      [(c) => c.v("caffeine") >= 1, "Clearing caffeine", (c) => `Your liver is clearing caffeine, ${c.v("caffeine").toFixed(2)} mg/L left.`],
      [(c) => activeSubstance(c) !== undefined, (c) => `Clearing ${inSentence(activeSubstance(c)?.substance.label ?? "")}`, (c) => `Your body is clearing ${inSentence(activeSubstance(c)?.substance.label ?? "")}.`],
      [always, "Quiet", (c) => (c.v("bladderMl") >= REFERENCE.bladder.firstDesireMl ? `Your bladder is filling, about ${tens(c.v("bladderMl"))} ml.` : "Your liver and kidneys are ticking over.")],
    ],
    level: (c) => Math.max(c.v("alcohol") * 2, c.v("caffeine") / CAFFEINE.feltAboveMgL / REFERENCE.systemFullAt.caffeineFelt, (c.v("bladderMl") / REFERENCE.bladder.capacityMl) * REFERENCE.systemFullAt.bladderShare),
  },
  reproductive: {
    rows: [
      [(c) => phaseOf(c) !== null, (c) => PHASE_WORD[phaseOf(c) ?? "follicular"], (c) => `${PHASE_SAYS[phaseOf(c) ?? "follicular"].day}.`],
      [always, "Quiet", (c) => (c.tr.scenario.body.sex === "female" ? "No cycle logged." : "Nothing here is changing today.")],
    ],
    level: (c) => (c.tr.cycle ? CYCLE.cramps.amount * REFERENCE.systemFullAt.crampsShare : 0),
  },
};

function firstRow<Row extends WordRow | StatusRow>(rows: readonly Row[], c: Context, reading: (id: ReadingId) => Reading): Row {
  const row = rows.find(([test]) => test(c, reading));
  if (!row) throw new Error("A word table must end with a row that always passes");
  return row;
}

const wordOf = (row: WordRow | StatusRow, c: Context) => (typeof row[1] === "string" ? row[1] : row[1](c));

type RailEntry = Omit<SystemStatus, "emphasis">;

function systemStatus(id: Exclude<SystemId, "overview">, c: Context, reading: (id: ReadingId) => Reading): RailEntry {
  const spec = SYSTEM_STATUS[id];
  const def = systemById(id);
  const row = firstRow(spec.rows, c, reading);
  return { word: wordOf(row, c), quiet: row === spec.rows.at(-1), level: clamp01(spec.level(c, reading)), tone: worstTone([...def.readings, ...def.more].map((r) => reading(r).tone)), sentence: row[2](c, reading) };
}

// What matters most right now: what needs attention first, then how busy each system is.
const importance = (s: RailEntry) => (s.quiet ? -1 : TONE_RANK[s.tone] * FEELING_DISPLAY.toneOutweighsLevel + s.level);

export function systemsOf(c: Context, reading: (id: ReadingId) => Reading, headline: string): Record<SystemId, SystemStatus> {
  const parts = {
    digestion: systemStatus("digestion", c, reading),
    energy: systemStatus("energy", c, reading),
    circulation: systemStatus("circulation", c, reading),
    muscles: systemStatus("muscles", c, reading),
    brain: systemStatus("brain", c, reading),
    immune: systemStatus("immune", c, reading),
    clearing: systemStatus("clearing", c, reading),
    reproductive: systemStatus("reproductive", c, reading),
  };
  const all = Object.values(parts);
  // Being ill is why the person is looking, however busy the other systems are.
  const rank = (p: RailEntry) => importance(p) + (p === parts.immune && fighting(c) ? FEELING_DISPLAY.toneOutweighsLevel : 0);
  const shown = new Set(all.filter((p) => !p.quiet).sort((a, b) => rank(b) - rank(a)).slice(0, FEELING_DISPLAY.mostEmphasised));
  const marked = (part: RailEntry): SystemStatus => ({ ...part, emphasis: shown.has(part) });
  // The whole body is as busy as its busiest part and as loud as its loudest. Its sentence is the headline.
  const overviewRow = firstRow(OVERVIEW_WORDS, c, reading);
  const overview: SystemStatus = { word: wordOf(overviewRow, c), quiet: overviewRow === OVERVIEW_WORDS.at(-1), level: Math.max(...all.map((p) => p.level)), tone: worstTone(all.map((p) => p.tone)), sentence: headline, emphasis: false };
  return { overview, digestion: marked(parts.digestion), energy: marked(parts.energy), circulation: marked(parts.circulation), muscles: marked(parts.muscles), brain: marked(parts.brain), immune: marked(parts.immune), clearing: marked(parts.clearing), reproductive: marked(parts.reproductive) };
}
