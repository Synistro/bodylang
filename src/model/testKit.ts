import type { Nutrients } from "./scenario";

export const hm = (h: number, m = 0) => h * 60 + m;

export const NO_NUTRIENTS: Nutrients = {
  grams: 0,
  waterMl: 0,
  carbsG: 0,
  sugarG: 0,
  fatG: 0,
  proteinG: 0,
  fiberG: 0,
  caffeineMg: 0,
  alcoholG: 0,
};
