import { value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";
import { clamp01 } from "../model/curve";

const FULL = { gutKcal: 200, sugarMgMin: 600, proteinGMin: 2.5, fatGMin: 0.5 };

export const smallIntestineCloseup = defineCloseup({
  organ: "small_intestine",
  settings: {
    food: "How much food is passing along the intestine",
    sugar: "How fast sugar and protein are crossing into the blood",
    fat: "How fast fat is crossing into the lymph",
  },
  fromModel: ({ trajectory }, minute) => ({
    food: clamp01(value(trajectory, "gutKcal", minute) / FULL.gutKcal),
    sugar: clamp01(
      value(trajectory, "glucoseAbsorbMgMin", minute) / FULL.sugarMgMin +
        value(trajectory, "proteinAbsorbGMin", minute) / FULL.proteinGMin,
    ),
    fat: clamp01(value(trajectory, "fatAbsorbGMin", minute) / FULL.fatGMin),
  }),
  travels: {
    sugar: { kind: "blood", from: "here", through: [], to: "liver" },
    fat: { kind: "lymph", from: "here", through: ["chest"], to: "heart" },
  },
});
