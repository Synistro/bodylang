import { FEEL, PROCESS } from "../model/params";
import { value } from "../model/simulate";
import { defineCloseup } from "./define";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const FULL_SLEEP_PRESSURE = PROCESS.sleepPressureFullH * FEEL.sleepPressurePerHour;

export const brainCloseup = defineCloseup({
  organ: "brain",
  settings: {
    tired: "How much tired signal is falling onto the brain cells, which builds the longer you are awake",
    caffeine: "How many of the seats on brain cells caffeine is holding, so the tired signal bounces off them",
  },
  fromModel: ({ trajectory }, minute) => ({
    tired: clamp01(value(trajectory, "sleepPressure", minute) / FULL_SLEEP_PRESSURE),
    caffeine: value(trajectory, "occupancy", minute),
  }),
  travels: {
    caffeine: { kind: "blood", from: "small_intestine", through: ["chest", "neck"], to: "here" },
  },
});
