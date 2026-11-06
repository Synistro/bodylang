import { describe, expect, it } from "vitest";
import type { GuideStep } from "../actions/schemas";
import type { BodyEvent } from "../model/events/types";
import { isStill, Lane, systemLanes, threadLanes, workedMuscleLanes } from "../model/lanes";
import { simulate } from "../model/engine/simulate";
import { Intake, Scenario } from "../model/scenario";
import { systemById } from "../model/systems";
import { SystemId } from "../model/ids";
import { dayViewOf, viewStops, Walkthrough } from "./dayView";
import { hm } from "../model/testKit";

const PIZZA: Intake = {
  id: "pizza",
  label: "Pizza",
  at: hm(16, 45),
  grams: 240,
  waterMl: 110,
  carbsG: 72,
  sugarG: 8,
  fatG: 26,
  proteinG: 28,
  fiberG: 4,
  caffeineMg: 0,
  alcoholG: 0,
  liquid: false,
};
const SQUATS: BodyEvent = {
  id: "legs",
  label: "Squats",
  preset: "training",
  from: -1770,
  until: -1710,
  intensity: 0.8,
  muscles: [{ group: "quads", load: 1 }],
  symptoms: [],
  custom: null,
  source: "test",
};

const day = (intakes: Intake[], events: BodyEvent[] = []) => {
  const scenario: Scenario = {
    body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
    intakes,
    activities: [
      { from: 0, posture: "sleeping" },
      { from: 450, posture: "sitting" },
    ],
    substances: [],
    events,
  };
  return simulate(scenario);
};

const systemPage = (tr: ReturnType<typeof day>, now: number, system: SystemId) => {
  const { readings, more } = systemById(system);
  return {
    tr,
    now,
    lanes: systemLanes(tr, now, system),
    muscles: null,
    walkthrough: null,
    readings: new Set<string>([...readings, ...more]),
  };
};

const step = (title: string, at: number | null, level: "pain" | "tears" = "pain"): GuideStep => ({
  title,
  say: "Words",
  system: null,
  process: null,
  organ: "muscle",
  muscle: "quads",
  at,
  closeup: { organ: "muscle", light: [level], set: {}, compare: null, basis: null },
});

const walkthrough = (steps: GuideStep[], index = 0): Walkthrough => ({ steps, index });

describe("what the day panel shows", () => {
  it("draws every thing logged on today's chart, however many there are", () => {
    const meals = Array.from({ length: 7 }, (_, i) => ({
      ...PIZZA,
      id: `meal_${i}`,
      label: `Meal ${i}`,
      at: hm(8 + i * 1.5),
    }));
    const tr = day(meals);
    const view = dayViewOf({
      tr,
      now: hm(18),
      lanes: threadLanes(tr, hm(18)),
      muscles: null,
      walkthrough: null,
      readings: null,
    });
    expect(view.kind).toBe("today");
    if (view.kind === "today") expect(view.lanes).toHaveLength(7);
  });

  it("puts what is still going on first, newest first", () => {
    const tr = day([{ ...PIZZA, id: "lunch", label: "Lunch", at: hm(12) }, PIZZA]);
    expect(threadLanes(tr, hm(17)).map((lane) => lane.id)).toEqual(["intake:pizza", "intake:lunch"]);
  });

  it("has nothing to draw for a resting heart, and nothing ahead of it either", () => {
    const view = dayViewOf(systemPage(day([]), hm(15), "circulation"));
    expect(view.kind).toBe("quiet");
    expect(viewStops(view, hm(15))).toEqual([{ at: hm(15), label: null }]);
  });

  it("says what comes next on an empty morning, soonest first and without the clock in the words", () => {
    const tr = day([]);
    const view = dayViewOf({
      tr,
      now: hm(10),
      lanes: threadLanes(tr, hm(10)),
      muscles: null,
      walkthrough: null,
      readings: null,
    });
    expect(view.kind).toBe("next");
    if (view.kind !== "next") return;
    const ats = view.items.map((item) => item.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(view.items.map((item) => item.reading.id)).toContain("bladder");
    for (const item of view.items) expect(item.what).not.toMatch(/\d\d:\d\d$/);
    expect(viewStops(view, hm(10)).map((stop) => stop.at)).toEqual(expect.arrayContaining(ats));
  });

  it("keeps today's chart for anything an amount, and for anything out of its typical range", () => {
    const tr = day([PIZZA]);
    const amount: Lane = threadLanes(tr, hm(17))[0];
    expect(isStill([amount], hm(17))).toBe(false);
    const heart = systemLanes(day([]), hm(15), "circulation")[0];
    expect(isStill([heart], hm(15))).toBe(true);
    const band = heart.band;
    if (!band) throw new Error("A heart rate has a typical range");
    expect(isStill([{ ...heart, band: { ...band, low: band.high + 0.01, high: band.high + 0.02 } }], hm(15))).toBe(
      false,
    );
    expect(isStill([{ ...heart, ghost: heart.values }], hm(15))).toBe(false);
  });

  it("draws a sore muscle over days, from the session to normal again", () => {
    const tr = day([], [SQUATS]);
    const view = dayViewOf({
      tr,
      now: hm(10),
      lanes: [],
      muscles: { kind: "one", group: "quads" },
      walkthrough: null,
      readings: null,
    });
    expect(view.kind).toBe("recovery");
    if (view.kind !== "recovery") return;
    expect(view.span.from).toBeLessThan(SQUATS.from);
    expect(view.span.to).toBeGreaterThan(hm(10) + 1440);
    expect(view.moments).toEqual([{ at: SQUATS.from, label: "Squats", intakes: [] }]);
    const [sore] = view.lanes;
    expect(sore.id).toBe("soreness");
    expect(sore.mark?.text).toMatch(/^Normal /);
    expect(Math.max(...sore.values) - Math.min(...sore.values)).toBeGreaterThan(0.5);
    expect(sore.read(hm(10))).toBe("Strong");
  });

  it("draws every worked muscle's recovery on the Muscles page, and leaves today alone once they are rested", () => {
    const tr = day([], [SQUATS]);
    const view = dayViewOf({
      tr,
      now: hm(10),
      lanes: workedMuscleLanes(tr, hm(10)),
      muscles: { kind: "worked", groups: null },
      walkthrough: null,
      readings: null,
    });
    expect(view.kind).toBe("recovery");
    if (view.kind === "recovery") expect(view.lanes.map((lane) => lane.id)).toEqual(["quads"]);
    const rested = day([]);
    expect(
      dayViewOf({
        tr: rested,
        now: hm(15),
        lanes: [],
        muscles: { kind: "one", group: "quads" },
        walkthrough: null,
        readings: new Set(),
      }).kind,
    ).toBe("quiet");
  });

  it("gives a walkthrough that leaves today its own time, with one stop per step", () => {
    const tr = day([], [SQUATS]);
    const steps = [
      step("During the session", -1740),
      step("A day later", -300),
      step("Still that day", null),
      step("Three days later", hm(10) + 4320, "tears"),
    ];
    const view = dayViewOf({
      tr,
      now: hm(10),
      lanes: [],
      muscles: { kind: "one", group: "quads" },
      walkthrough: walkthrough(steps, 3),
      readings: null,
    });
    expect(view.kind).toBe("story");
    if (view.kind !== "story") return;
    expect(view.stops.map((stop) => stop.at)).toEqual([-1740, -300, -300, hm(10) + 4320]);
    expect(view.current).toBe(3);
    expect(view.span.from).toBeLessThan(-1740);
    expect(view.span.to).toBeGreaterThan(hm(10) + 4320);
    expect(view.lanes[0].label).toBe("tears");
  });

  it("leaves a walkthrough that stays within today on today's chart", () => {
    const tr = day([PIZZA]);
    const steps = [step("Now", hm(17)), step("Tonight", hm(21))];
    const view = dayViewOf({
      tr,
      now: hm(17),
      lanes: threadLanes(tr, hm(17)),
      muscles: null,
      walkthrough: walkthrough(steps),
      readings: null,
    });
    expect(view.kind).toBe("today");
  });

  it("while exploring, leaves your day off the chart and keeps what the question added", () => {
    const yourDay = day([PIZZA]);
    const beer = { ...PIZZA, id: "beer", label: "Beer", at: hm(18) };
    const exploring = day([PIZZA, beer]);
    const page = { tr: exploring, now: hm(19), muscles: null, walkthrough: null, readings: null, yourDay };
    const view = dayViewOf({ ...page, lanes: threadLanes(exploring, hm(19)) });
    if (view.kind !== "today") throw new Error(`expected today, got ${view.kind}`);
    expect(view.moments.map((moment) => moment.label)).toEqual(["Beer"]);
    expect(view.lanes.map((lane) => lane.label)).not.toContain("Pizza");
  });

  it("while exploring with nothing added, has nothing to say about your day", () => {
    const yourDay = day([PIZZA]);
    const view = dayViewOf({
      tr: yourDay,
      now: hm(19),
      lanes: threadLanes(yourDay, hm(19)),
      muscles: null,
      walkthrough: null,
      readings: null,
      yourDay,
    });
    expect(view.kind).toBe("quiet");
    if (view.kind === "quiet") expect(view.moments).toEqual([]);
  });

  it("while exploring, drops a curve the question didn't move and keeps one it did", () => {
    const yourDay = day([PIZZA]);
    const exploring = day([PIZZA, { ...PIZZA, id: "beer", label: "Beer", at: hm(18), alcoholG: 40 }]);
    expect(systemLanes(yourDay, hm(19), "clearing", yourDay).every((lane) => lane.sameAsYourDay)).toBe(true);
    const [lane] = systemLanes(exploring, hm(19), "clearing", yourDay);
    const lanes = [
      {
        ...lane,
        id: "moved",
        sameAsYourDay: false,
        ghost: lane.values,
        values: lane.values.map((value) => value * 0.5),
      },
      { ...lane, id: "unmoved", sameAsYourDay: true },
    ];
    const view = dayViewOf({
      tr: exploring,
      now: hm(19),
      lanes,
      muscles: null,
      walkthrough: null,
      readings: null,
      yourDay,
    });
    if (view.kind !== "today") throw new Error(`expected today, got ${view.kind}`);
    expect(view.lanes.map((one) => one.id)).toEqual(["moved"]);
  });
});
