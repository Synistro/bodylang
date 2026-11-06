import { curveStrength } from "../model/events/curves";
import { REFERENCE } from "../model/params";
import { Trajectory, value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";
import { clamp01 } from "../model/curve";

const BREATHS = REFERENCE.breathing.scale;
const COUGH_FEELING = "coughing";

export const breathsPerMinute = (level: number) => BREATHS.min + (BREATHS.max - BREATHS.min) * level;

// How strong the cough is now, from whatever illness logged it.
function coughAt(tr: Trajectory, t: number) {
  let strongest = 0;
  for (const event of tr.events) {
    for (const feeling of event.feelings) {
      if (feeling.id === COUGH_FEELING) strongest = Math.max(strongest, feeling.amount * curveStrength(feeling, event.from, event.ends, t));
    }
  }
  return strongest;
}

export const lungsCloseup = defineCloseup({
  organ: "lungs",
  settings: {
    rate: "How fast you are breathing, which brings in the oxygen the blood carries away",
    irritation: "How irritated and swollen the airway lining is, which narrows the airways",
    cough: "How strong a cough is, which sets how often one travels up the airways",
  },
  fromModel: ({ trajectory }, minute) => {
    const cough = clamp01(coughAt(trajectory, minute));
    return {
      rate: clamp01((value(trajectory, "breaths", minute) - BREATHS.min) / (BREATHS.max - BREATHS.min)),
      irritation: cough,
      cough,
    };
  },
  travels: {
    rate: { kind: "blood", from: "here", through: [], to: "heart" },
    cough: { kind: "nerve", from: "here", through: ["neck"], to: "brain" },
  },
  about: "The model has one curve for a cough, so the irritated lining and the cough drawn here both follow it.",
});
