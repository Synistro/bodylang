import { REFERENCE } from "../model/params";
import { value } from "../model/simulate";
import { defineCloseup } from "./define";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const SCALE = REFERENCE.temperature.scale;
const GERMS_PER_INFLAMMATION = 1.6;

export const degreesC = (level: number) => SCALE.min + (SCALE.max - SCALE.min) * level;

export const spleenCloseup = defineCloseup({
  organ: "spleen",
  settings: {
    immune: "How many immune cells have left the blood and gathered where the trouble is",
    germs: "How many germs the immune cells are up against",
    temperature: `Body temperature, from ${SCALE.min} °C at 0 to ${SCALE.max} °C at 1`,
  },
  fromModel: ({ trajectory }, minute) => ({
    immune: clamp01(value(trajectory, "immune", minute)),
    germs: clamp01(value(trajectory, "inflammation", minute) * GERMS_PER_INFLAMMATION),
    temperature: clamp01((value(trajectory, "temperature", minute) - SCALE.min) / (SCALE.max - SCALE.min)),
  }),
  travels: {
    immune: { kind: "blood", from: "here", through: [], to: "heart" },
    temperature: { kind: "blood", from: "here", through: ["chest", "neck"], to: "brain" },
  },
  about: "The model has no count of germs, so the germs drawn here follow how inflamed the body is.",
});
