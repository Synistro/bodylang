import { daysIntoCycle, hormonesAt } from "../model/cycle";
import { CYCLE } from "../model/params";
import { defineCloseup } from "./define";
import { clamp01 } from "../model/curve";

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const FOLLICLE_AT_REST = 5 / 24; // a follicle starts at about a fifth of the size it reaches before it lets go of the egg
const EMPTYING_DAYS = 3;
const EGG_LEAVES_OVER_DAYS = 2;
// The fastest the drawing's hormones leave, in dots a second. What a level of 1 means, since the model has no rate for this.
export const OVARY_HORMONES_FULL = 4.5;
const HORMONES_WITH_NO_CYCLE = 0.25;

export const ovariesCloseup = defineCloseup({
  organ: "ovaries",
  settings: {
    follicle: "How big the follicle holding this month's egg has grown",
    empty_follicle:
      "How far the follicle has turned, after letting go of the egg, into the small body that makes progesterone",
    egg: "How far the released egg has got along the tube, from 0 before it leaves to 1 once it has gone",
    hormones: "How much estrogen and progesterone the ovary is sending into the blood",
  },
  fromModel: ({ trajectory: { cycle } }, minute) => {
    if (!cycle)
      return {
        follicle: FOLLICLE_AT_REST,
        empty_follicle: 0,
        egg: 0,
        hormones: HORMONES_WITH_NO_CYCLE / OVARY_HORMONES_FULL,
      };
    const day = daysIntoCycle(cycle, minute);
    const ovulation = cycle.lengthDays - CYCLE.lutealDays;
    const emptied = clamp01((day - ovulation) / EMPTYING_DAYS);
    const { estradiol, progesterone } = hormonesAt(cycle, minute);
    return {
      follicle: lerp(FOLLICLE_AT_REST, 1, clamp01(day / ovulation)) * (1 - emptied),
      empty_follicle: emptied,
      egg: clamp01((day - ovulation + 1) / EGG_LEAVES_OVER_DAYS),
      hormones: Math.min(OVARY_HORMONES_FULL, estradiol / 280 + progesterone / 12) / OVARY_HORMONES_FULL,
    };
  },
  travels: {
    // An egg has no kind of its own. Lymph's plain line is the one that doesn't read as blood or food.
    egg: { kind: "lymph", from: "here", through: [], to: "uterus" },
    hormones: { kind: "blood", from: "here", through: [], to: "uterus" },
  },
});
