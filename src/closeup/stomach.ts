import { STOMACH } from "../model/params";
import { value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";
import { clamp01 } from "../model/curve";

// What a level of 1 means in the model's units. The drawing has room for this much food in pieces, and the
// fastest meal the model empties stays below this rate.
export const STOMACH_FULL = { kcal: 1050, emptyingKcalPerMin: 12 };

export const stomachCloseup = defineCloseup({
  organ: "stomach",
  settings: {
    fullness: "How full the stomach is with food and drink",
    food: "How much solid food is in it, drawn as pieces",
    emptying: "How fast food is leaving through the outlet into the intestine",
  },
  fromModel: ({ trajectory }, minute) => ({
    fullness: clamp01(
      (value(trajectory, "stomachMl", minute) - STOMACH.restingVolumeMl) /
        (STOMACH.fullnessMl - STOMACH.restingVolumeMl),
    ),
    food: clamp01(value(trajectory, "stomachKcal", minute) / STOMACH_FULL.kcal),
    emptying: clamp01(value(trajectory, "emptyingKcalPerMin", minute) / STOMACH_FULL.emptyingKcalPerMin),
  }),
  travels: {
    emptying: { kind: "food", from: "here", through: [], to: "small_intestine" },
  },
});
