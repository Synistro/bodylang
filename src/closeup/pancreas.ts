import { value } from "../model/simulate";
import { defineCloseup } from "./define";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const SECRETION_FULL = 4; // above resting, where the drawing's stream of insulin is at its fullest
const SUGAR = { restingMgDl: 90, fullMgDl: 170 }; // the model keeps blood sugar in mg/dL

export const pancreasCloseup = defineCloseup({
  organ: "pancreas",
  settings: {
    sugar: "How much sugar the blood passing these cells is carrying, above its resting level",
    insulin: "How fast the cells are releasing insulin into the blood",
  },
  fromModel: ({ trajectory }, minute) => ({
    sugar: clamp01((value(trajectory, "glucose", minute) - SUGAR.restingMgDl) / (SUGAR.fullMgDl - SUGAR.restingMgDl)),
    insulin: clamp01(value(trajectory, "insulinSecretion", minute) / SECRETION_FULL),
  }),
  travels: {
    insulin: { kind: "blood", from: "here", through: [], to: "liver" },
    sugar: { kind: "blood", from: "small_intestine", through: [], to: "here" },
  },
});
