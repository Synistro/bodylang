import { value } from "../model/simulate";
import { defineCloseup } from "./define";

const BEATS = { least: 30, most: 220 };

export const beatsPerMinute = (level: number) => BEATS.least + (BEATS.most - BEATS.least) * level;

export const heartCloseup = defineCloseup({
  organ: "heart",
  settings: {
    rate: "How fast the heart is beating",
    brain: "The share of the blood going to the brain",
    gut: "The share of the blood going to the gut",
    kidneys: "The share of the blood going to the kidneys",
    muscle: "The share of the blood going to the muscles",
  },
  fromModel: ({ trajectory }, minute) => ({
    rate: (value(trajectory, "hr", minute) - BEATS.least) / (BEATS.most - BEATS.least),
    brain: value(trajectory, "flowBrain", minute),
    gut: value(trajectory, "flowGut", minute),
    kidneys: value(trajectory, "flowKidneys", minute),
    muscle: value(trajectory, "flowMuscle", minute),
  }),
  travels: {
    brain: { kind: "blood", from: "here", through: ["neck"], to: "brain" },
    gut: { kind: "blood", from: "here", through: [], to: "small_intestine" },
    kidneys: { kind: "blood", from: "here", through: [], to: "kidneys" },
    muscle: { kind: "blood", from: "here", through: ["hips"], to: "muscle" },
  },
});
