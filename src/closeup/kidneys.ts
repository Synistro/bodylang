import { BLOOD_FLOW } from "../model/params";
import { Trajectory, value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";
import { clamp01 } from "../model/curve";

// What a level of 1 means in the model's units. The most blood the model sends here, as a multiple of its
// resting share, stays below bloodFold. The drawing's stream of urine is at its fullest at urineMlPerMin.
export const KIDNEY_FULL = { bloodFold: 1.25, urineMlPerMin: 3 / 0.7 };

// What reaches the bladder each minute, which is the model's urine. A void only drops the level, so it counts as none.
export const urineMlPerMin = (tr: Trajectory, t: number) => Math.max(0, value(tr, "bladderMl", t + 1) - value(tr, "bladderMl", t));

export const kidneysCloseup = defineCloseup({
  organ: "kidneys",
  settings: {
    blood: "How much blood is reaching the filters, which is most at rest and falls in hard exercise",
    returning: "How much of the filtered water is going back into the blood",
    urine: "How fast urine is being made and sent on to the bladder",
  },
  fromModel: ({ trajectory }, minute) => {
    const blood = clamp01(value(trajectory, "flowKidneys", minute) / BLOOD_FLOW.rest.kidneys / KIDNEY_FULL.bloodFold);
    return { blood, returning: blood, urine: clamp01(urineMlPerMin(trajectory, minute) / KIDNEY_FULL.urineMlPerMin) };
  },
  travels: {
    blood: { kind: "blood", from: "heart", through: [], to: "here" },
    returning: { kind: "blood", from: "here", through: [], to: "heart" },
    // Urine has no kind of its own. Lymph's plain line is the one that doesn't read as blood or food.
    urine: { kind: "lymph", from: "here", through: [], to: "bladder" },
  },
  about: "The model knows how much blood reaches the kidneys and how much urine they make. The water going back follows the blood.",
});
