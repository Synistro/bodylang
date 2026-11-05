import type { OrganId } from "../model/simulate";

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
};

export const isOrganId = (id: string | null): id is OrganId => id !== null && Object.hasOwn(ORGAN_NAME, id);
