import { MUSCLE_GROUPS } from "./muscleGroups";
import type { OrganId } from "./simulate";
import type { ReadingId } from "./assess";

// How the app divides the body for navigation. Each entry says what lights up in 3D and which
// readings the panel shows when you pick that system.
export type SystemId = "overview" | "digestion" | "energy" | "circulation" | "muscles" | "brain" | "immune" | "clearing" | "reproductive";

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
  { id: "brain", title: "Brain & mood", organs: ["brain"], readings: ["alertness", "stressLevel", "reward", "caffeine"], more: ["alcohol"] },
  { id: "immune", title: "Illness & recovery", organs: ["spleen"], readings: ["temperature", "immune"], more: ["inflammation"] },
  { id: "clearing", title: "Liver & kidneys", organs: ["liver", "kidneys", "bladder"], readings: ["caffeine", "alcohol", "bladder", "fluid"], more: ["flowKidneys"] },
  { id: "reproductive", title: "Reproductive", organs: ["uterus", "ovaries", "prostate"], readings: ["cycleDay", "estradiol", "progesterone"], more: [] },
];

export const ORGAN_NAME: Record<OrganId, string> = {
  brain: "Brain",
  heart: "Heart",
  lungs: "Lungs",
  liver: "Liver",
  stomach: "Stomach",
  pancreas: "Pancreas",
  spleen: "Spleen",
  small_intestine: "Small intestine",
  large_intestine: "Large intestine",
  kidneys: "Kidneys",
  bladder: "Bladder",
  muscle: "Muscles",
  fat: "Fat tissue",
  uterus: "Uterus",
  ovaries: "Ovaries",
  prostate: "Prostate",
};

export const systemById = (id: SystemId) => {
  const found = SYSTEMS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown system ${id}`);
  return found;
};
