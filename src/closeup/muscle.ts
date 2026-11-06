import { muscleStoryAt } from "../model/events/muscles";
import { defineCloseup } from "./define";

const QUIET = { work: 0, tears: 0, immune: 0, swelling: 0, pain: 0, rebuilt: 0 };

export const muscleCloseup = defineCloseup({
  organ: "muscle",
  settings: {
    work: "How hard the fibres are contracting",
    tears: "How many tiny tears are in the fibres",
    immune: "How many immune cells have gathered at the tears",
    swelling: "How much fluid has pushed the fibres apart",
    pain: "How strongly the nerve is sending pain signals",
    rebuilt: "How much of the damage has been rebuilt, slightly thicker than before",
  },
  // The model has one curve for soreness, so immune cells, fluid and the nerve all follow it.
  fromModel: ({ trajectory, muscle }, minute) => {
    if (!muscle) return QUIET;
    const { load, damage, soreness, healed } = muscleStoryAt(trajectory.muscleEvents, muscle, minute);
    return { work: load, tears: damage, immune: soreness, swelling: soreness, pain: soreness, rebuilt: healed };
  },
  travels: {
    pain: { kind: "nerve", from: "here", through: ["hips", "chest", "neck"], to: "brain" },
    immune: { kind: "blood", from: "heart", through: ["hips"], to: "here" },
  },
  about: "The model has one curve for soreness, so the immune cells, fluid and nerve signals drawn here all follow it. The drawing isn't to scale.",
});
