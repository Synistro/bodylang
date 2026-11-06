import type { ReadingId } from "../../model/ids";
import { cyclePhase } from "../../model/cycle";
import { effectAt, eventActiveAt, eventLevelAt, curveStrength, isMuscleState, MuscleState, muscleStateAt, namesOf, ResolvedEvent } from "../../model/events";
import { MUSCLE_GROUPS, MuscleGroup } from "../../model/muscleGroups";
import { BLOOD_FLOW, CYCLE, Evidence, INSULIN, MUSCLE_RECOVERY, REFERENCE, SOURCES, STOMACH } from "../../model/params";
import { ledgerAt, SeriesName, Trajectory, value } from "../../model/engine/trajectory";
import { POSTURES } from "../../model/scenario";
import { OrganId } from "../../model/ids";
import { recoverySentence } from "./muscleRecovery";

export interface OrganStory {
  doing: string; // one plain sentence on what it is doing now, read by the slot under the clock
  rows: ReadingId[]; // at most three; a number the figure already states stays out
  line?: string; // what it does, for an organ with neither a figure nor a reading to show it
  evidence: Evidence;
  source: string;
}

interface Now {
  tr: Trajectory;
  t: number;
  v: (name: SeriesName) => number;
  moving: boolean;
  said: string | null; // what the strongest live event says happens at this organ
  training: ResolvedEvent | undefined;
  illness: ResolvedEvent | undefined;
  stress: ResolvedEvent | undefined;
}

// The brain is its whole system, so opening it and clicking it show one page: how you feel, the
// drawing of what is happening, then what is acting on it.
export const BRAIN_PAGE = { feel: ["alertness", "stressLevel", "reward"], acting: ["caffeine", "alcohol"] } satisfies Record<string, ReadingId[]>;

const STOP_LIVE_FROM = 0.15;
const COUGH_FEELING = "coughing";
const FOOD_MIN_KCAL = 5;
const DROWSY_FROM = 0.3;
const CAFFEINE_FELT_FROM_PERCENT = 1;

const hasFever = ({ v }: Now) => v("temperature") >= REFERENCE.temperature.feverC;
const working = ({ training, t }: Now) => training !== undefined && effectAt(training, "muscleFlow", t) > 0.02;

function stomach(now: Now): OrganStory {
  const { v } = now;
  const kcal = v("stomachKcal");
  let doing = "Empty and resting.";
  if (kcal > FOOD_MIN_KCAL && now.stress) doing = "Holding your food longer while you are under stress.";
  else if (kcal > FOOD_MIN_KCAL && v("emptyingKcalPerMin") >= 0.5) doing = "Squeezing your food toward the outlet, a little with each wave.";
  else if (kcal > FOOD_MIN_KCAL) doing = "Mixing your food before any of it leaves.";
  else if (v("stomachMl") > STOMACH.restingVolumeMl + REFERENCE.stomach.emptyAboveRestingMl) doing = "Passing liquid straight through.";
  return { doing, rows: ["stomach"], evidence: "A", source: SOURCES.emptying };
}

function smallIntestine({ v }: Now): OrganStory {
  const absorbing = v("glucoseAbsorbMgMin") >= 1000 / 60;
  const holding = v("gutKcal") > FOOD_MIN_KCAL;
  return {
    doing: absorbing ? "Passing your food into your blood." : holding ? "Breaking down what the stomach lets through." : "Quiet, with nothing to absorb.",
    rows: ["absorbing", "flowGut"],
    evidence: "C",
    source: "My estimate",
  };
}

function largeIntestine({ tr, t }: Now): OrganStory {
  const held = tr.scenario.intakes.reduce((sum, intake) => sum + (ledgerAt(tr, intake.id, t)?.colon ?? 0), 0);
  return {
    doing: held >= FOOD_MIN_KCAL ? "Holding the fibre and leftovers you didn't absorb." : "Quiet, with nothing from today yet.",
    rows: [],
    evidence: "C",
    source: "My estimate",
  };
}

function liver(now: Now): OrganStory {
  const { v } = now;
  let doing = v("liverUptakeGMin") > v("hepaticOutputGMin") ? "Storing sugar from your gut as fuel." : "Feeding your blood from its fuel store.";
  if (v("alcohol") > REFERENCE.alcohol.presentAboveGPerL) doing = "Breaking down alcohol first.";
  else if (working(now)) doing = "Releasing sugar for your working muscles.";
  else if (now.stress) doing = "Releasing extra sugar while you are under stress.";
  return { doing, rows: ["alcohol"], evidence: "B", source: REFERENCE.liverGlycogen.source };
}

function pancreas({ v }: Now): OrganStory {
  const fold = v("insulin") / INSULIN.baselineUUPerMl;
  return {
    doing: fold < REFERENCE.insulin.atRestBelowFold ? "Keeping insulin at its resting level." : "Releasing insulin so your cells take in sugar.",
    rows: ["glucose"],
    evidence: "B",
    source: SOURCES.minimalModel,
  };
}

function heart(now: Now): OrganStory {
  const { v } = now;
  let doing = "Beating steadily.";
  if (now.moving || working(now)) doing = "Sending extra blood to your muscles.";
  else if (now.illness && hasFever(now)) doing = "Beating faster with the fever.";
  else if (now.stress) doing = "Beating faster under stress.";
  else if (v("flowGut") > BLOOD_FLOW.rest.gut + 0.02) doing = "Sending extra blood to your gut while you digest.";
  else if (now.said) doing = now.said;
  return { doing, rows: ["bloodPressure", "output"], evidence: "B", source: SOURCES.flow };
}

function brain({ v }: Now): OrganStory {
  let doing = v("drowsy") > DROWSY_FROM ? "Your tired signal is getting through, so you feel sleepy." : "Your tired signal is building slowly.";
  if (v("occupancy") * 100 >= CAFFEINE_FELT_FROM_PERCENT) doing = "Caffeine sits where your tired signal would land, so you feel more awake.";
  return { doing, rows: [...BRAIN_PAGE.feel, ...BRAIN_PAGE.acting], evidence: "B", source: SOURCES.adenosine };
}

function coughing(event: ResolvedEvent, t: number) {
  const cough = event.feelings.find((feeling) => feeling.id === COUGH_FEELING);
  return cough ? curveStrength(cough, event.from, event.ends, t) > 0.1 : false;
}

function lungs(now: Now): OrganStory {
  const { v, illness } = now;
  let doing = "Breathing steadily.";
  if (illness && coughing(illness, now.t)) doing = "Your airway lining is irritated, which sets off the cough.";
  else if (illness) doing = `Your airway lining is inflamed by ${illness.causeName}.`;
  else if (now.moving || working(now)) doing = "Breathing faster to feed your muscles.";
  else if (now.said) doing = now.said;
  else if (now.stress) doing = "Breathing faster under stress.";
  else if (v("digestion") >= 0.04) doing = "Breathing a little faster while you digest.";
  return { doing, rows: [], evidence: "A", source: REFERENCE.breathing.source };
}

function spleen(now: Now): OrganStory {
  const { illness } = now;
  let doing = now.said ?? "Nothing to fight, with a few immune cells on patrol.";
  if (illness) doing = hasFever(now) ? `Your immune system turned up your temperature to fight ${illness.causeName}.` : `Immune cells are gathering to fight ${illness.causeName}.`;
  return { doing, rows: ["temperature", "immune"], evidence: illness ? illness.evidence : "C", source: illness ? illness.source : "General anatomy" };
}

function kidneys(now: Now): OrganStory {
  const { v, tr, t } = now;
  const urineMlPerMin = value(tr, "bladderMl", t + 1) - value(tr, "bladderMl", t);
  const dry = v("fluidBalance") <= -tr.scenario.body.weightKg * REFERENCE.fluid.noticeableShareOfWeight * 1000;
  let doing = urineMlPerMin > 1.5 ? "Filtering your blood and sending extra water to your bladder." : "Filtering your blood.";
  if (dry) doing = "Holding on to water, because you are a little dry.";
  else if (now.stress) doing = "The adrenal glands on top are releasing stress hormones.";
  return { doing, rows: ["fluid", "flowKidneys"], evidence: "C", source: "My estimate" };
}

function bladder({ v }: Now): OrganStory {
  const ml = v("bladderMl");
  const r = REFERENCE.bladder;
  const doing = ml < r.firstDesireMl ? "Filling slowly from your kidneys." : ml < r.strongDesireMl ? "Filling up, and you may notice it." : "Full enough that you need to go.";
  return { doing, rows: ["bladder"], evidence: "B", source: r.source };
}

const strongest = (state: MuscleState) => Math.max(state.work, state.fatigue, state.soreness, state.repair);

function muscleOverview(now: Now): OrganStory {
  const r = REFERENCE.muscleState;
  const states = MUSCLE_GROUPS.map((group) => ({ group, state: muscleStateAt(now.tr.muscleEvents, group, now.t) }));
  const named = (list: typeof states) => namesOf(list.map(({ group, state }) => ({ group, load: strongest(state) })));
  const workingNow = states.filter(({ state }) => state.work >= r.workingFrom);
  const recovering = states.filter(({ state }) => strongest(state) >= r.repairingFrom);
  let doing = "All rested.";
  if (workingNow.length) doing = `Working your ${named(workingNow)}.`;
  else if (recovering.length) doing = `Your ${named(recovering)} ${recovering.length === 1 && !/s$/.test(named(recovering)) ? "is" : "are"} recovering.`;
  return { doing, rows: ["muscleUptake", "flowMuscle"], evidence: "B", source: recovering.length ? r.source : SOURCES.sitting };
}

function fat({ v, tr }: Now): OrganStory {
  const storing = v("tg") - tr.anthro.baselineTg > 8;
  return { doing: storing ? "Storing fat from your meal." : "Releasing a little fat for fuel.", rows: ["tg"], evidence: "B", source: SOURCES.lipemia };
}

const CYCLE_EVIDENCE = { evidence: CYCLE.evidence, source: CYCLE.source };

function uterus({ tr, t }: Now): OrganStory {
  const { cycle } = tr;
  if (!cycle) return { doing: "Resting, with no cycle logged.", rows: [], evidence: "C", source: "General anatomy" };
  const phase = cyclePhase(cycle, t);
  const doing = phase === "period" ? "Shedding its lining." : phase === "luteal" ? "Keeping its lining ready." : "Rebuilding its lining.";
  return { doing, rows: ["cycleDay"], ...CYCLE_EVIDENCE };
}

function ovaries({ tr, t }: Now): OrganStory {
  const { cycle } = tr;
  if (!cycle) return { doing: "Resting, with no cycle logged.", rows: [], evidence: "C", source: "General anatomy" };
  const phase = cyclePhase(cycle, t);
  const doing = phase === "ovulation" ? "Releasing an egg about now." : phase === "luteal" ? "The empty follicle is making progesterone." : "A follicle is growing and making estrogen.";
  return { doing, rows: ["estradiol", "progesterone"], ...CYCLE_EVIDENCE };
}

function prostate({ tr, t }: Now): OrganStory {
  const sex = tr.events.some((event) => event.preset === "sex" && event.from <= t && eventLevelAt(event, t) >= MUSCLE_RECOVERY.activeAbove);
  return { doing: sex ? "Refilling its fluid after sexual activity." : "Making its share of seminal fluid, around the urethra.", rows: ["bladder"], evidence: "C", source: "General anatomy" };
}

// A new organ is one new row. Each story reads the event behind it first, and otherwise says what the organ does on an ordinary day.
const STORIES: Record<OrganId, (now: Now) => OrganStory> = {
  uterus,
  ovaries,
  prostate,
  stomach,
  small_intestine: smallIntestine,
  large_intestine: largeIntestine,
  liver,
  pancreas,
  heart,
  brain,
  lungs,
  spleen,
  kidneys,
  bladder,
  muscle: muscleOverview,
  fat,
};

// A stop reports on its organ for as long as what it shows is still moving.
function stopStrength(event: ResolvedEvent, shows: ResolvedEvent["stops"][number]["shows"], t: number) {
  if (shows === undefined || isMuscleState(shows)) return eventLevelAt(event, t);
  const effect = event.effects.find((e) => e.channel === shows);
  return effect ? curveStrength(effect, event.from, event.ends, t) : eventLevelAt(event, t);
}

function saidAt(organ: OrganId, live: ResolvedEvent[], t: number) {
  for (const event of live) {
    const elapsed = t - event.from;
    for (const stop of [...event.stops].reverse()) {
      if (stop.organ === organ && stop.afterMin <= elapsed && stopStrength(event, stop.shows, t) >= STOP_LIVE_FROM) return stop.say;
    }
  }
  return null;
}

export function organStory(organ: OrganId, tr: Trajectory, t: number): OrganStory {
  const v = (name: SeriesName) => value(tr, name, t);
  const posture = POSTURES[Math.round(v("posture"))];
  const live = tr.events.filter((event) => eventActiveAt(event, t)).sort((a, b) => eventLevelAt(b, t) - eventLevelAt(a, t));
  const ongoing = (preset: ResolvedEvent["preset"]) => live.find((event) => event.preset === preset);
  return STORIES[organ]({
    tr,
    t,
    v,
    moving: posture === "walking" || posture === "running",
    said: saidAt(organ, live, t),
    training: ongoing("training"),
    illness: ongoing("illness"),
    stress: ongoing("stress"),
  });
}

export function muscleStory(group: MuscleGroup, tr: Trajectory, t: number): OrganStory {
  const now = muscleStateAt(tr.muscleEvents, group, t);
  const later = muscleStateAt(tr.muscleEvents, group, t + 60);
  const worked = tr.muscleEvents.some((event) => event.from <= t && event.muscles.some((m) => m.group === group));
  return { doing: recoverySentence(now, later.soreness > now.soreness, worked), rows: [], evidence: REFERENCE.muscleState.evidence, source: REFERENCE.muscleState.source };
}
