import { describe, expect, it } from "vitest";
import { assess } from "./assess";
import { BodyEvent } from "./events";
import { LANES } from "./params";
import { dayMoments, dayStops, fitWindow, muscleStateLanes, processLanes, readingLanes, systemLanes, threadLanes, workedMuscleLanes } from "./lanes";
import { Intake, Scenario, simulate } from "./simulate";

const hm = (h: number, m = 0) => h * 60 + m;

const COFFEE: Intake = { id: "coffee", label: "Coffee", at: hm(8, 30), grams: 250, waterMl: 245, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 95, alcoholG: 0, liquid: true };
const PIZZA: Intake = { id: "pizza", label: "Pizza", at: hm(16, 45), grams: 240, waterMl: 110, carbsG: 72, sugarG: 8, fatG: 26, proteinG: 28, fiberG: 4, caffeineMg: 0, alcoholG: 0, liquid: false };
const BEER: Intake = { id: "beer", label: "Beer", at: hm(19), grams: 500, waterMl: 460, carbsG: 18, sugarG: 2, fatG: 0, proteinG: 2, fiberG: 0, caffeineMg: 0, alcoholG: 20, liquid: true };

const day = (intakes: Intake[], events: BodyEvent[] = []) => {
  const scenario: Scenario = { body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 }, intakes, activities: [{ from: 0, posture: "sleeping" }, { from: 450, posture: "sitting" }], substances: [], events };
  return simulate(scenario);
};

const LEG_DAY: BodyEvent = { id: "legs", label: "Leg day", preset: "training", from: hm(10), until: hm(11), intensity: 0.8, muscles: [{ group: "quads", load: 0.9 }, { group: "glutes", load: 0.7 }], symptoms: [], custom: null, source: "test" };

describe("the day chart's lanes", () => {
  it("draws each thing logged, oldest on top, in plain ink", () => {
    const lanes = threadLanes(day([COFFEE, PIZZA]), hm(17));
    expect(lanes.map((l) => [l.id, l.system])).toEqual([
      ["intake:coffee", "overview"],
      ["intake:pizza", "overview"],
    ]);
  });

  it("says when food is digested, and draws it gone by then", () => {
    const pizza = threadLanes(day([COFFEE, PIZZA]), hm(17)).find((l) => l.id === "intake:pizza");
    expect(pizza?.mark?.text).toMatch(/^Digested \d\d:\d\d$/);
    expect(pizza?.mark?.over).toBe(true);
    const at = pizza?.mark?.at ?? 0;
    expect(at).toBeGreaterThan(hm(21));
    expect(at).toBeLessThan(hm(26));
    expect(pizza?.values[Math.round((at - LANES.from) / LANES.stepMin)]).toBeLessThan(0.05);
  });

  it("marks coffee at bedtime with how much of the cup is left", () => {
    const coffee = threadLanes(day([COFFEE, PIZZA]), hm(17)).find((l) => l.id === "intake:coffee");
    expect(coffee?.mark?.text).toMatch(/^\d+% left at 23:30$/);
    expect(coffee?.mark?.at).toBe(hm(23, 30));
    expect(coffee?.mark?.over).toBe(false);
  });

  it("says when alcohol clears", () => {
    const beer = threadLanes(day([BEER]), hm(20)).find((l) => l.id === "intake:beer");
    expect(beer?.mark?.text).toMatch(/^Clear \d\d:\d\d$/);
  });

  it("names an end past the drawn day at the edge", () => {
    const tr = day([], [LEG_DAY]);
    const legs = threadLanes(tr, hm(14)).find((l) => l.id === "event:legs");
    expect(legs?.mark).toBeNull();
    expect(legs?.beyond).toMatch(/^Over (tomorrow|in \d+ days)/);
    expect(workedMuscleLanes(tr, hm(14)).map((l) => l.id)).toContain("quads");
    expect(muscleStateLanes(tr, hm(14), "quads").map((l) => l.id)).toContain("soreness");
  });

  it("says when something has no end yet", () => {
    const tr = day([], [{ id: "cold", label: "Cold", preset: "illness", from: hm(8), until: null, intensity: 0.6, muscles: [], symptoms: ["cough"], custom: null, source: "" }]);
    expect(threadLanes(tr, hm(14))[0]).toMatchObject({ mark: null, beyond: "Still going" });
  });

  it("marks a reading where its forecast says, in the viewed system's colour", () => {
    const tr = day([COFFEE, PIZZA]);
    const lanes = readingLanes(tr, hm(17), ["glucose", "stomach"], "energy");
    const sugar = lanes.find((l) => l.id === "glucose");
    const reading = assess(tr, hm(17)).readings.find((r) => r.id === "glucose");
    expect(sugar?.mark).toEqual({ at: reading?.forecastAt, text: reading?.forecastShort, over: false });
    expect(sugar?.system).toBe("energy");
  });

  it("follows one process by its numbered stops", () => {
    const lanes = processLanes(day([COFFEE, PIZZA]), hm(17), "intake:pizza");
    expect(lanes.length).toBeGreaterThan(1);
    expect(lanes[0]).toMatchObject({ label: "Stomach", badge: { kind: "number", number: 1 } });
    expect(lanes[0].mark?.text).toMatch(/^Clear \d\d:\d\d$/);
  });

  it("draws readings for a process that isn't one thing moving through the body", () => {
    const tr = day([COFFEE, PIZZA]);
    const insulin = processLanes(tr, hm(17), "insulin");
    expect(insulin.map((l) => l.id)).toEqual(["glucose", "insulin", "muscleUptake", "glycogen"]);
    expect(insulin[0].read(hm(17))).toMatch(/mmol\/L$/);
    const legs = processLanes(day([], [LEG_DAY]), hm(14), "event:legs");
    expect(legs.map((l) => l.id).sort()).toEqual(["glutes", "quads"]);
  });

  it("says a stop cleared when it did, however long ago that was", () => {
    const lanes = processLanes(day([COFFEE, PIZZA]), hm(17), "intake:coffee");
    const at = lanes.find((l) => l.label === "Stomach")?.mark?.at ?? 0;
    expect(at).toBeGreaterThan(COFFEE.at);
    expect(at).toBeLessThan(hm(11));
  });

  it("draws what runs out as an amount, and what never does as a level against its typical band", () => {
    const tr = day([COFFEE, PIZZA]);
    const [hr] = readingLanes(tr, hm(17), ["hr"], "circulation");
    expect(hr.shape).toBe("level");
    expect(hr.band?.high ?? 0).toBeGreaterThan(hr.band?.low ?? 1);
    expect(Math.min(...hr.values)).toBeGreaterThan(0.05);
    const [stomach] = readingLanes(tr, hm(17), ["stomach"], "digestion");
    expect(stomach.shape).toBe("amount");
    expect(stomach.band).toBeNull();
    expect(Math.min(...stomach.values)).toBe(0);
    expect(stomach.mark).toMatchObject({ over: true });
  });

  it("reads each row at any minute, in the words and units the page uses", () => {
    const tr = day([COFFEE, PIZZA]);
    const [hr] = readingLanes(tr, hm(17), ["hr"], "circulation");
    expect(hr.read(hm(17))).toMatch(/^\d+ bpm$/);
    const pizza = threadLanes(tr, hm(17)).find((l) => l.id === "intake:pizza");
    expect(pizza?.read(hm(16))).toBe("");
    expect(pizza?.read(hm(17))).toBe("100% left");
    expect(pizza?.read(hm(25))).toBe("digested");
  });

  it("leaves out a reading with nothing to draw all day", () => {
    expect(readingLanes(day([PIZZA]), hm(17), ["alcohol"], "clearing")).toEqual([]);
  });

  it("frames what is going on, from where it began to where it ends", () => {
    const tr = day([COFFEE, PIZZA]);
    const meal = fitWindow(processLanes(tr, hm(17), "intake:pizza"), hm(17));
    expect(meal.from).toBeLessThanOrEqual(hm(14));
    const clears = processLanes(tr, hm(17), "intake:pizza")[0].mark?.at ?? 0;
    expect(clears).toBeGreaterThan(hm(21));
    expect(meal.to).toBeGreaterThan(clears);
    const overview = fitWindow(threadLanes(tr, hm(17)), hm(17));
    expect(overview.from).toBeLessThan(COFFEE.at);
    expect(overview.to).toBeGreaterThan(hm(23, 30));
    expect(overview.to).toBeLessThan(hm(25));
  });

  it("always shows some past and future around now, even with nothing logged", () => {
    const { from, to } = fitWindow([], hm(12));
    expect(from).toBeLessThan(hm(12));
    expect(to).toBeGreaterThan(hm(12));
    expect(to - from).toBeGreaterThanOrEqual(LANES.fit.leastSpanMin);
    const late = fitWindow([], hm(25, 50));
    expect(late.to).toBe(LANES.to);
    expect(late.to - late.from).toBeGreaterThanOrEqual(LANES.fit.leastSpanMin);
  });

  it("lists everything worth stopping at, in order of time", () => {
    const tr = day([COFFEE, PIZZA]);
    const lanes = threadLanes(tr, hm(17));
    const stops = dayStops(lanes, dayMoments(tr, hm(17)), hm(17)).map((s) => s.at);
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
    expect(stops).toContain(COFFEE.at);
    expect(stops).toContain(hm(17));
    expect(stops).toContain(lanes[0].mark?.at);
  });

  it("draws your real day beside a what-if, on the same scale, only where they differ", () => {
    const real = day([COFFEE]);
    const whatIf = day([COFFEE, PIZZA]);
    const [sugar] = readingLanes(whatIf, hm(17), ["glucose"], "energy", real);
    expect(sugar.ghost).not.toBeNull();
    const peak = Math.round((hm(18) - LANES.from) / LANES.stepMin);
    expect(sugar.values[peak]).toBeGreaterThan(sugar.ghost?.[peak] ?? 1);
    expect(readingLanes(real, hm(17), ["glucose"], "energy", real)[0].ghost).toBeNull();
    expect(readingLanes(real, hm(17), ["glucose"], "energy")[0].ghost).toBeNull();
  });

  it("marks what only exists in a what-if", () => {
    const lanes = threadLanes(day([COFFEE, PIZZA]), hm(17), day([COFFEE]));
    expect(lanes.map((l) => [l.id, l.hypothetical])).toEqual([
      ["intake:coffee", false],
      ["intake:pizza", true],
    ]);
  });

  it("names what was logged, in order", () => {
    expect(dayMoments(day([COFFEE, PIZZA]), hm(17))).toEqual([
      { at: COFFEE.at, label: "Coffee", intakes: ["coffee"] },
      { at: PIZZA.at, label: "Pizza", intakes: ["pizza"] },
    ]);
  });

  it("never draws more than fits, and every value stays in its lane", () => {
    const tr = day([COFFEE, PIZZA, BEER], [LEG_DAY]);
    for (const system of ["overview", "digestion", "energy", "circulation", "muscles", "brain", "immune", "clearing"] as const) {
      const lanes = systemLanes(tr, hm(17), system);
      expect(lanes.length).toBeLessThanOrEqual(LANES.most);
      for (const lane of lanes) for (const v of lane.values) expect(v).toBeGreaterThanOrEqual(-0.001), expect(v).toBeLessThanOrEqual(1.001);
    }
  });
});
