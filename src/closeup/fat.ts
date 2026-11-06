import { value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Blood fat over its resting level, in mg/dL: where the droplets are at their fullest, and where the cells start taking fat in.
export const FAT_OVER = { full: 110, storingFrom: 8 };
const RELEASING_BETWEEN_MEALS = 0.25;

export const fatCloseup = defineCloseup({
  organ: "fat",
  settings: {
    taking_in: "How fast fat from a meal is moving out of the blood into the cells, which swells the droplets inside them",
    releasing: "How fast the cells are letting fat out into the blood as fuel",
  },
  fromModel: ({ trajectory }, minute) => {
    const over = value(trajectory, "tg", minute) - trajectory.anthro.baselineTg;
    return { taking_in: clamp01(over / FAT_OVER.full), releasing: over > FAT_OVER.storingFrom ? 0 : RELEASING_BETWEEN_MEALS };
  },
  travels: {
    taking_in: { kind: "blood", from: "heart", through: [], to: "here" },
    releasing: { kind: "blood", from: "here", through: ["hips"], to: "muscle" },
  },
  about: "Fat in the blood sets how fast the cells take it in. The model doesn't track fat released, so that is drawn as a low, steady trickle between meals.",
});
