import { cyclePhase, hormonesAt, liningShare } from "../model/cycle";
import { CYCLE } from "../model/params";
import { defineCloseup } from "./define";

// The fastest the drawing's hormones arrive, in dots a second. What a level of 1 means, since the model has no rate for this.
export const UTERUS_HORMONES_FULL = 3;
const HORMONES_WITH_NO_CYCLE = 0.2;

export const uterusCloseup = defineCloseup({
  organ: "uterus",
  settings: {
    lining: "How thick the lining of the uterus is",
    shedding: "How much of the lining is coming away and leaving as a period",
    hormones: "How much estrogen and progesterone is arriving at the lining in the blood",
  },
  fromModel: ({ trajectory: { cycle } }, minute) => {
    if (!cycle) return { lining: CYCLE.lining.least, shedding: 0, hormones: HORMONES_WITH_NO_CYCLE / UTERUS_HORMONES_FULL };
    const { estradiol, progesterone } = hormonesAt(cycle, minute);
    return {
      lining: liningShare(cycle, minute),
      shedding: cyclePhase(cycle, minute) === "period" ? 1 : 0,
      hormones: Math.min(UTERUS_HORMONES_FULL, estradiol / 400 + progesterone / 16) / UTERUS_HORMONES_FULL,
    };
  },
  travels: {
    hormones: { kind: "blood", from: "ovaries", through: [], to: "here" },
  },
});
