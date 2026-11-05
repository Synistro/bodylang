import type { Feeling, Reading, ReadingId } from "./assess";
import { ChannelId, curveStrength } from "./events";
import { EXTENSIONS } from "./extensions";
import { CYCLE, Evidence, PROCESS, SOURCES } from "./params";
import type { Process } from "./processes";
import { caffeineLedgerAt, Intake, kcalOf, ledgerAt, Trajectory } from "./simulate";

// Where something on screen came from. The model computing it is the ordinary case. What Claude adds
// from its own knowledge, and what the model computed from Claude's numbers, are told apart from that.
export type OriginKind = "model" | "claude-input" | "claude" | "usda" | "you";

export interface Origin {
  kind: OriginKind;
  detail: string;
}

export const ORIGIN_HEADING: Record<OriginKind, string> = {
  model: "Computed by the model",
  "claude-input": "Computed by the model, from Claude's numbers",
  claude: "Added by Claude",
  usda: "From the USDA food table",
  you: "You said this",
};

// How far to trust a source: A is consistent human studies or official bodies, B human studies with wide
// variation, and C an estimate chosen to match the shape of published curves.
const EVIDENCE_WORDS: Record<Evidence, string> = {
  A: "Evidence A: consistent human studies or official bodies.",
  B: "Evidence B: human studies with wide variation.",
  C: "Evidence C: an estimate chosen to match the shape of published curves.",
};

export const modelOrigin = (evidence: Evidence, source: string): Origin => ({ kind: "model", detail: `${EVIDENCE_WORDS[evidence]} ${source}` });

export const SENTENCE_ORIGIN: Origin = { kind: "model", detail: "Worked out by the app's rules from the model's numbers." };

export const CLAUDE_WORDS: Origin = { kind: "claude", detail: "Claude wrote this. Any number in it that the model returned is plain, and one it didn't is underlined." };

// Which channels of an event can move each reading, so a sauna only marks what a sauna touches.
const READING_CHANNELS: Partial<Record<ReadingId, ChannelId[]>> = {
  hr: ["heartRate"],
  output: ["heartRate"],
  breaths: ["breathing"],
  temperature: ["temperature"],
  bloodPressure: ["bloodPressure"],
  stressLevel: ["stress"],
  reward: ["reward"],
  inflammation: ["inflammation"],
  immune: ["immune"],
  burn: ["metabolism"],
  glucose: ["insulinSensitivity", "liverOutput"],
  insulin: ["insulinSensitivity"],
  fluid: ["fluidLoss"],
  flowMuscle: ["muscleFlow"],
  alertness: ["drowsiness", "stress", "reward"],
};

// The readings that follow from what was eaten.
const FOOD_READINGS: ReadonlySet<ReadingId> = new Set<ReadingId>(["glucose", "insulin", "tg", "stomach", "absorbing", "glycogen", "muscleUptake", "fuel", "flowGut", "caffeine", "receptors", "alertness", "alcohol", "bladder"]);

const NOTICEABLE_SHARE_OF_PEAK = 0.05;

function stillAtWork(tr: Trajectory, intake: Intake, t: number): boolean {
  if (intake.at > t) return false;
  const food = ledgerAt(tr, intake.id, t);
  const caffeine = caffeineLedgerAt(tr, intake.id, t);
  const moving = food ? food.stomach + food.intestine + food.blood : 0;
  return moving > kcalOf(intake) * PROCESS.heldInStomachShare || (caffeine ? caffeine.blood : 0) > intake.caffeineMg * PROCESS.heldInStomachShare;
}

const composedByClaude = (intake: Intake) => intake.source?.kind !== "table";

export function readingOrigin(reading: Reading, tr: Trajectory, t: number): Origin {
  const base = `Typical range, evidence ${reading.evidence}: ${reading.source}`;
  const channels = READING_CHANNELS[reading.id] ?? [];
  const events = tr.events.filter((event) => event.preset === "custom" && event.effects.some((effect) => channels.includes(effect.channel) && curveStrength(effect, event.from, event.ends, t) >= NOTICEABLE_SHARE_OF_PEAK));
  const foods = FOOD_READINGS.has(reading.id) ? tr.scenario.intakes.filter((intake) => stillAtWork(tr, intake, t)) : [];
  const estimatedFoods = foods.filter(composedByClaude);
  const named = [...events.map((event) => event.label), ...estimatedFoods.map((intake) => intake.label)];
  if (named.length) return { kind: "claude-input", detail: `${[...new Set(named)].join(", ")}: Claude's estimate. ${base}` };
  return { kind: "model", detail: foods.length ? `Portions are Claude's estimates unless you corrected them. ${base}` : base };
}

export function feelingOrigin(feeling: Feeling): Origin {
  if (feeling.byClaude) return { kind: "claude", detail: "Claude described this for something the model has no built-in curve for." };
  return { kind: "model", detail: "Worked out by the app's rules from the model's numbers. What a person actually feels varies a lot." };
}

export function foodOrigin(intake: Intake): Origin {
  const portion = intake.portionBy === "you" ? "You corrected the portion." : "Claude estimated the portion.";
  if (intake.source?.kind === "table") return { kind: "usda", detail: `${intake.source.name}. ${portion} The model computes what happens to it.` };
  return { kind: "claude-input", detail: `Claude estimated what this contains. ${portion} The model computes what happens to it.` };
}

const LINE_SOURCES: Record<string, { evidence: Evidence; source: string }> = {
  insulin: { evidence: "B", source: SOURCES.minimalModel },
  "fat-route": { evidence: "B", source: SOURCES.lipemia },
  circulation: { evidence: "B", source: SOURCES.flow },
  alertness: { evidence: "B", source: SOURCES.adenosine },
  clearing: { evidence: "A", source: SOURCES.caffeine },
  cycle: { evidence: CYCLE.evidence, source: CYCLE.source },
};

// A line through the body takes after what it is a line of.
export function processOrigin(tr: Trajectory, process: Process): Origin {
  const known = LINE_SOURCES[process.id];
  if (known) return modelOrigin(known.evidence, known.source);
  const [kind, id] = process.id.split(/:(.*)/s);
  if (kind === "ext") {
    const extension = EXTENSIONS.find((e) => e.id === id);
    return { kind: "claude", detail: `A separate Claude session wrote this process, and its tests passed. It reads the model and can't change it. ${extension ? `${EVIDENCE_WORDS[extension.evidence]} ${extension.source}` : ""}` };
  }
  if (kind === "event") {
    const event = tr.events.find((e) => e.id === id);
    if (event?.preset === "custom") return { kind: "claude-input", detail: `Claude chose the numbers and wrote the words for this. Its source: ${event.source || "its own estimate"}.` };
    if (event) return modelOrigin(event.evidence, event.source);
  }
  if (kind === "substance") {
    const substance = tr.substances.get(id)?.substance;
    return { kind: "claude-input", detail: `The model moves this through the body, using the half-life and dose Claude supplied. Its source: ${substance?.source || "its own knowledge"}.` };
  }
  const named = tr.scenario.intakes.filter((intake) => intake.id === id);
  const meal = kind === "meal" ? tr.scenario.intakes.filter((intake) => process.title.toLowerCase().includes(intake.label.toLowerCase())) : [];
  const foods = named.length ? named : meal;
  if (foods.some(composedByClaude)) return { kind: "claude-input", detail: `Claude estimated what ${foods.filter(composedByClaude).map((intake) => intake.label).join(" and ")} contains. The model computes where it goes.` };
  if (foods.length) return { kind: "usda", detail: `${foods.map((intake) => (intake.source?.kind === "table" ? intake.source.name : intake.label)).join(" and ")}. Claude estimated the portion unless you corrected it. The model computes where it goes.` };
  return SENTENCE_ORIGIN;
}
