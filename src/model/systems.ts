import { MUSCLE_GROUPS } from "./muscleGroups";
import type { OrganId } from "./simulate";
import type { ReadingId } from "./assess";

// How the app divides the body for navigation. Each entry says what lights up in 3D and which
// readings the panel shows when you pick that system.
export type SystemId = "overview" | "digestion" | "energy" | "circulation" | "muscles" | "brain" | "immune" | "clearing";

export interface SystemDef {
  id: SystemId;
  title: string;
  organs: OrganId[];
  readings: ReadingId[]; // the primary list, at most four
  more: ReadingId[]; // everything else, behind a "More" control
}

const muscleReadings = MUSCLE_GROUPS.map((group): ReadingId => `muscle:${group}`);

export const SYSTEMS: SystemDef[] = [
  { id: "overview", title: "Overview", organs: [], readings: ["glucose", "hr", "stomach", "temperature"], more: ["insulin", "tg", "caffeine", "glycogen"] },
  { id: "digestion", title: "Digestion", organs: ["stomach", "small_intestine", "large_intestine", "pancreas", "liver"], readings: ["stomach", "absorbing", "flowGut"], more: [] },
  { id: "energy", title: "Sugar & energy", organs: ["pancreas", "liver", "muscle", "fat"], readings: ["glucose", "insulin", "glycogen", "tg"], more: ["muscleUptake", "burn", "fuel"] },
  { id: "circulation", title: "Heart & lungs", organs: ["heart", "lungs"], readings: ["hr", "bloodPressure", "breaths", "flowGut"], more: ["output", "flowMuscle", "flowBrain", "flowKidneys"] },
  { id: "muscles", title: "Muscles", organs: ["muscle"], readings: muscleReadings.slice(0, 4), more: muscleReadings.slice(4) },
  { id: "brain", title: "Brain & mood", organs: ["brain"], readings: ["alertness", "caffeine", "receptors", "stressLevel"], more: ["reward"] },
  { id: "immune", title: "Immune", organs: ["spleen"], readings: ["temperature", "inflammation", "immune"], more: [] },
  { id: "clearing", title: "Liver & kidneys", organs: ["liver", "kidneys", "bladder"], readings: ["caffeine", "alcohol", "bladder", "fluid"], more: ["flowKidneys"] },
];

export const systemById = (id: SystemId) => {
  const found = SYSTEMS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown system ${id}`);
  return found;
};
