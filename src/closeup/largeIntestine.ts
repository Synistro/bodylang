import { ledgerAt, Trajectory } from "../model/simulate";
import { defineCloseup } from "./define";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// How many kcal held here bring each of the drawing's streams to its fullest.
export const LARGE_INTESTINE_FULL = { contentsKcal: 83.2, waterKcal: 100.8 };

export const heldKcal = (tr: Trajectory, minute: number) => tr.scenario.intakes.reduce((sum, intake) => sum + (ledgerAt(tr, intake.id, minute)?.colon ?? 0), 0);

export const largeIntestineCloseup = defineCloseup({
  organ: "large_intestine",
  settings: {
    contents: "How much of what you couldn't absorb, such as fibre, is here moving slowly along",
    water: "How fast water is being drawn back through the wall into the blood",
  },
  fromModel: ({ trajectory }, minute) => {
    const held = heldKcal(trajectory, minute);
    return { contents: clamp01(held / LARGE_INTESTINE_FULL.contentsKcal), water: clamp01(held / LARGE_INTESTINE_FULL.waterKcal) };
  },
  travels: {
    contents: { kind: "food", from: "small_intestine", through: [], to: "here" },
    water: { kind: "blood", from: "here", through: [], to: "liver" },
  },
  about: "The model counts the energy that reaches the large intestine, and the contents and the water drawn back both follow that count.",
});
