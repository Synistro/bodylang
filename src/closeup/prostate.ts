import { eventLevelAt } from "../model/events";
import { value } from "../model/engine/trajectory";
import { defineCloseup } from "./define";

const VOIDS_WHEN_FALLS_MORE_THAN_ML = 1; // the bladder only drops when it empties

export const prostateCloseup = defineCloseup({
  organ: "prostate",
  settings: {
    fluid: "How hard the glands are working to make their share of seminal fluid, which rises with sexual activity and stays up for a while after",
    urine: "How much urine is passing through the urethra, which only happens while the bladder empties",
  },
  fromModel: ({ trajectory }, minute) => ({
    fluid: Math.max(0, ...trajectory.events.filter((event) => event.preset === "sex" && event.from <= minute).map((event) => eventLevelAt(event, minute))),
    urine: value(trajectory, "bladderMl", minute + 1) < value(trajectory, "bladderMl", minute) - VOIDS_WHEN_FALLS_MORE_THAN_ML ? 1 : 0,
  }),
  travels: {},
});
