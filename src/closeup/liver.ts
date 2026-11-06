import { LIVER } from "../model/params";
import { value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";
import { clamp01 } from "../model/curve";

// What a level of 1 means in the model's units. The fastest the model moves sugar, the liver feeding a hard
// run, stays below this rate.
export const LIVER_FULL = { glycogenG: LIVER.glycogenMaxG, sugarGPerMin: 0.8 };

export const liverCloseup = defineCloseup({
  organ: "liver",
  settings: {
    store: "How full the liver's store of sugar fuel is",
    taking_in: "How fast sugar from the gut is coming into the liver",
    releasing: "How fast the liver is releasing sugar into the blood",
  },
  fromModel: ({ trajectory }, minute) => ({
    store: clamp01(value(trajectory, "liverGlycogen", minute) / LIVER_FULL.glycogenG),
    taking_in: clamp01(value(trajectory, "liverUptakeGMin", minute) / LIVER_FULL.sugarGPerMin),
    releasing: clamp01(value(trajectory, "hepaticOutputGMin", minute) / LIVER_FULL.sugarGPerMin),
  }),
  travels: {
    taking_in: { kind: "blood", from: "small_intestine", through: [], to: "here" },
    releasing: { kind: "blood", from: "here", through: [], to: "heart" },
  },
});
