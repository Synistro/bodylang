import type { MuscleGroup } from "./muscleGroups";

export const ORGANS = ["brain", "heart", "lungs", "liver", "stomach", "pancreas", "spleen", "small_intestine", "large_intestine", "kidneys", "bladder", "muscle", "fat", "uterus", "ovaries", "prostate"] as const;
export type OrganId = (typeof ORGANS)[number];

export type SystemId = "overview" | "digestion" | "energy" | "circulation" | "muscles" | "brain" | "immune" | "clearing" | "reproductive";

// Named paths through the body, defined in src/scene/routes.ts. A stop lists the ones leading to it.
export const ROUTE_IDS = ["esophagus", "stomach_out", "duodenum", "jejunum", "ileum", "colon", "portal_liver", "liver_out", "ivc", "svc", "to_lung_L", "to_lung_R", "from_lung_L", "from_lung_R", "arch", "carotid", "to_neck", "descending", "to_gut", "to_kidney_L", "to_kidney_R", "from_kidney_L", "from_kidney_R", "from_brain", "to_liver_art", "pancreas_portal", "lymph", "lymph_svc", "leg_L", "leg_R", "arm_L", "arm_R", "to_bladder_L", "to_bladder_R"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

export type ReadingId =
  | "glucose"
  | "insulin"
  | "tg"
  | "hr"
  | "output"
  | "breaths"
  | "flowGut"
  | "flowMuscle"
  | "flowBrain"
  | "flowKidneys"
  | "stomach"
  | "absorbing"
  | "glycogen"
  | "muscleUptake"
  | "burn"
  | "fuel"
  | "caffeine"
  | "receptors"
  | "alertness"
  | "alcohol"
  | "bladder"
  | "bloodPressure"
  | "temperature"
  | "stressLevel"
  | "inflammation"
  | "immune"
  | "reward"
  | "fluid"
  | "cycleDay"
  | "estradiol"
  | "progesterone"
  | `muscle:${MuscleGroup}`;

export type Tint = "chyme" | "glucose" | "fat" | "caffeine" | "insulin" | "alcohol" | "other" | null;
export type Substance = NonNullable<Tint>;

export type BodyLineId = "insulin" | "fat-route" | "circulation" | "alertness" | "clearing" | "cycle";

// A line that follows one thing has its kind and that thing's id in its own id.
export const processIds = {
  intake: (id: string) => `intake:${id}`,
  meal: (id: string) => `meal:${id}`,
  caffeine: (id: string) => `caffeine:${id}`,
  alcohol: (id: string) => `alcohol:${id}`,
  substance: (id: string) => `substance:${id}`,
  event: (id: string) => `event:${id}`,
  added: (id: string) => `ext:${id}`,
} as const;

export function parseProcessId(id: string): { kind: string; ref: string } {
  const at = id.indexOf(":");
  return at < 0 ? { kind: id, ref: "" } : { kind: id.slice(0, at), ref: id.slice(at + 1) };
}

export type ThreadKind = "food" | "drink" | "substance" | "training" | "illness" | "other";
