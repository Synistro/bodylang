import { REFERENCE } from "../model/params";
import { value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";
import { urineMlPerMin } from "./kidneys";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const { capacityMl, firstDesireMl, strongDesireMl } = REFERENCE.bladder;
const share = (ml: number) => (ml / capacityMl).toFixed(1);

// What a level of 1 means in the model's units. The drawing's drops are at their fastest at this rate.
export const BLADDER_FULL = { ml: capacityMl, fillingMlPerMin: 3.2 };

export const bladderCloseup = defineCloseup({
  organ: "bladder",
  settings: {
    fullness: `How full the bladder is, stretching as it fills. You start to notice it near ${share(firstDesireMl)} and need to go near ${share(strongDesireMl)}`,
    filling: "How fast urine is arriving from the kidneys",
  },
  fromModel: ({ trajectory }, minute) => ({
    fullness: clamp01(value(trajectory, "bladderMl", minute) / BLADDER_FULL.ml),
    filling: clamp01(urineMlPerMin(trajectory, minute) / BLADDER_FULL.fillingMlPerMin),
  }),
  travels: {
    // Urine has no kind of its own. Lymph's plain line is the one that doesn't read as blood or food.
    filling: { kind: "lymph", from: "kidneys", through: [], to: "here" },
    fullness: { kind: "nerve", from: "here", through: ["spine", "chest", "neck"], to: "brain" },
  },
});
