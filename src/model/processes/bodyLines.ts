import { BodyLineId, ReadingId } from "../ids";
import { CYCLE, Evidence, SOURCES } from "../params";

interface BodyLine {
  evidence: Evidence;
  source: string;
  readings: readonly ReadingId[]; // what its chart draws, since nothing moves through the body along it
  actsOnOrgans: boolean; // whether it earns a row on each organ it reaches
}

// What is known about each line that runs all day. Lines of food, doses and events take after what they follow.
const BODY_LINES: Record<BodyLineId, BodyLine> = {
  insulin: { evidence: "B", source: SOURCES.minimalModel, readings: ["glucose", "insulin", "muscleUptake", "glycogen"], actsOnOrgans: true },
  "fat-route": { evidence: "B", source: SOURCES.lipemia, readings: ["tg", "fuel"], actsOnOrgans: true },
  // Blood reaches everything all the time, so it says nothing about any one organ.
  circulation: { evidence: "B", source: SOURCES.flow, readings: ["hr", "output", "flowGut", "flowMuscle"], actsOnOrgans: false },
  alertness: { evidence: "B", source: SOURCES.adenosine, readings: ["alertness", "caffeine", "receptors"], actsOnOrgans: true },
  // The liver's and kidneys' round-up repeats what each thing already says for itself.
  clearing: { evidence: "A", source: SOURCES.caffeine, readings: ["caffeine", "alcohol", "bladder", "fluid"], actsOnOrgans: false },
  cycle: { evidence: CYCLE.evidence, source: CYCLE.source, readings: ["cycleDay", "estradiol", "progesterone"], actsOnOrgans: true },
};

export const bodyLineFacts = (id: string): BodyLine | null => (Object.hasOwn(BODY_LINES, id) ? BODY_LINES[id as BodyLineId] : null);
