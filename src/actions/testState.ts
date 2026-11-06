import type { DayContent } from "../model/day";
import type { BodyState, ViewState } from "./reduce";

// A state for tests that only care about part of it.
export const stateWith = (day: Partial<DayContent> = {}, view: Partial<ViewState> = {}, now = 12 * 60): BodyState => ({
  day: {
    body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
    intakes: [],
    activities: [],
    substances: [],
    events: [],
    cycle: null,
    assumptions: {},
    ...day,
  },
  now,
  view: { system: "overview", process: null, focus: null, focusMuscle: null, whatIf: null, ...view },
});
