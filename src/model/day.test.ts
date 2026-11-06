import { describe, expect, it } from "vitest";
import { reduce, BodyState } from "../agent/actions";
import { carryOver, clockAt, daysBetween, DayDoc, firstDay, parseDayDoc, stayAwake, typicalDayFromYesterday } from "./day";
import { DAY } from "./params";
import { processesAt } from "./processes";
import { simulate } from "./simulate";
import { postureAt, Scenario } from "./scenario";
import { threadsAt } from "./threads";

const body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const nothing = { grams: 0, waterMl: 0, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 0, alcoholG: 0 };
const coffee = (at: number) => ({ ...nothing, id: "coffee", label: "Coffee", at, grams: 250, waterMl: 245, caffeineMg: 200, liquid: true });
const beers = (at: number) => ({ ...nothing, id: "beers", label: "Beers", at, grams: 1000, waterMl: 930, carbsG: 30, sugarG: 0, alcoholG: 40, liquid: true });
const dinner = (at: number) => ({ ...nothing, id: "dinner", label: "Dinner", at, grams: 500, waterMl: 250, carbsG: 80, sugarG: 10, fatG: 40, proteinG: 40, fiberG: 6 });

const day = (over: Partial<DayDoc> = {}): DayDoc => ({ ...firstDay("2026-11-05", body), ...over });
const scenarioOf = (doc: DayDoc): Scenario => ({ body: doc.body, intakes: doc.intakes, activities: doc.activities, substances: doc.substances, events: doc.events });

describe("the clock", () => {
  it("counts a late night as part of the day it began in", () => {
    expect(clockAt(new Date(2026, 10, 6, 1, 30))).toEqual({ date: "2026-11-05", minute: 25 * 60 + 30 });
    expect(clockAt(new Date(2026, 10, 6, 3, 59))).toEqual({ date: "2026-11-05", minute: 27 * 60 + 59 });
  });

  it("starts a new day at the rollover", () => {
    expect(clockAt(new Date(2026, 10, 6, 4, 0))).toEqual({ date: "2026-11-06", minute: DAY.rolloverMin });
    expect(clockAt(new Date(2026, 10, 6, 13, 10))).toEqual({ date: "2026-11-06", minute: 13 * 60 + 10 });
  });

  it("crosses months and years", () => {
    expect(clockAt(new Date(2027, 0, 1, 2, 0)).date).toBe("2026-12-31");
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-11-05", "2026-11-05")).toBe(0);
  });
});

describe("carrying a day into the next", () => {
  it("moves every minute back by the days that passed", () => {
    const next = carryOver(day({ intakes: [coffee(23 * 60)], assumptions: { coffee: "A big cup" } }), "2026-11-06");
    expect(next.date).toBe("2026-11-06");
    expect(next.intakes[0].at).toBe(-60);
    expect(next.intakes[0].id).toBe("coffee@2026-11-05");
    expect(next.assumptions["coffee@2026-11-05"]).toBe("A big cup");
  });

  it("frees the id, so today's coffee doesn't replace yesterday's", () => {
    const next = carryOver(day({ intakes: [coffee(23 * 60)] }), "2026-11-06");
    expect(next.intakes.map((i) => i.id)).not.toContain("coffee");
  });

  it("drops food from longer ago than the carry", () => {
    expect(carryOver(day({ intakes: [coffee(8 * 60)] }), "2026-11-08").intakes).toEqual([]);
  });

  it("writes down yesterday's usual bedtime and starts a usual morning", () => {
    const next = carryOver(day(), "2026-11-06");
    expect(postureAt(next.activities, -60)).not.toBe("sleeping");
    expect(postureAt(next.activities, -10)).toBe("sleeping");
    expect(postureAt(next.activities, 60)).toBe("sleeping");
    expect(postureAt(next.activities, DAY.wakeMin + 1)).toBe("standing");
  });

  it("keeps a late night", () => {
    const late = day({ activities: [...typicalDayFromYesterday(), { from: DAY.sleepMin, posture: "sitting" }, { from: 26 * 60, posture: "sleeping" }] });
    const next = carryOver(late, "2026-11-06");
    expect(postureAt(next.activities, 30)).toBe("sitting");
    expect(postureAt(next.activities, 2 * 60 + 30)).toBe("sleeping");
    expect(postureAt(next.activities, DAY.wakeMin + 1)).toBe("standing");
  });

  it("forgets the days it wasn't opened", () => {
    expect(carryOver(day({ activities: [{ from: 600, posture: "running" }] }), "2026-11-10").activities).toEqual(typicalDayFromYesterday());
  });

  it("keeps an illness going and ended events for a fortnight", () => {
    const cold = { id: "cold", label: "Cold", preset: "illness", from: 500, until: null, intensity: 0.5, muscles: [], symptoms: [], custom: null, source: "" } as const;
    const gym = { id: "gym", label: "Gym", preset: "training", from: 500, until: 560, intensity: 0.6, muscles: [{ group: "chest", load: 1 }], symptoms: [], custom: null, source: "" } as const;
    const next = carryOver(day({ events: [cold, gym] as never }), "2026-11-07");
    expect(next.events.find((e) => e.label === "Cold")).toMatchObject({ id: "cold", from: 500 - 2880, until: null });
    expect(next.events.find((e) => e.label === "Gym")).toMatchObject({ id: "gym@2026-11-05", from: 500 - 2880, until: 560 - 2880 });
    expect(carryOver(day({ events: [gym] as never }), "2026-11-25").events).toEqual([]);
  });

  it("leaves a day already current alone", () => {
    const doc = day();
    expect(carryOver(doc, doc.date)).toBe(doc);
  });

  it("reads back what it wrote", () => {
    const next = carryOver(day({ intakes: [coffee(23 * 60)] }), "2026-11-06");
    expect(parseDayDoc(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(() => parseDayDoc({ version: 1, date: "../../etc" })).toThrow();
  });
});

describe("what carries through midnight", () => {
  // The same thing seen from either side of midnight has to read the same.
  const sameDayAndNext = (intake: (at: number) => Scenario["intakes"][number], hour: number) => {
    const tonight = day({ intakes: [intake(hour * 60)] });
    const next = carryOver(tonight, "2026-11-06");
    return { before: simulate(scenarioOf(tonight)), after: simulate(scenarioOf(next)) };
  };

  it("carries caffeine", () => {
    const { before, after } = sameDayAndNext(coffee, 23);
    const mid = before.series.caffeine[1440 + 60];
    expect(mid).toBeGreaterThan(1);
    expect(after.series.caffeine[60]).toBeCloseTo(mid, 1);
    expect(after.series.caffeine[0]).toBeCloseTo(before.series.caffeine[1440], 1);
  });

  it("carries alcohol", () => {
    const { before, after } = sameDayAndNext(beers, 23);
    expect(before.series.alcohol[1440 + 60]).toBeGreaterThan(0.1);
    expect(after.series.alcohol[60]).toBeCloseTo(before.series.alcohol[1440 + 60], 1);
  });

  it("carries blood fat from a late dinner", () => {
    const { before, after } = sameDayAndNext(dinner, 22);
    expect(before.series.tg[1440 + 60]).toBeGreaterThan(before.anthro.baselineTg + 10);
    expect(Math.abs(after.series.tg[60] - before.series.tg[1440 + 60])).toBeLessThan(3);
  });

  it("carries what is still in the stomach", () => {
    const { before, after } = sameDayAndNext(dinner, 23);
    expect(before.series.stomachKcal[1440]).toBeGreaterThan(50);
    expect(after.series.stomachKcal[0]).toBeCloseTo(before.series.stomachKcal[1440], 0);
  });

  it("makes the morning after a short night feel worse than a full one", () => {
    const full = simulate(scenarioOf(carryOver(day(), "2026-11-06")));
    const late = day({ activities: [...typicalDayFromYesterday(), { from: DAY.sleepMin, posture: "sitting" }, { from: 27 * 60, posture: "sleeping" }] });
    const short = simulate(scenarioOf(carryOver(late, "2026-11-06")));
    const morning = DAY.wakeMin + 30;
    expect(short.series.sleepPressure[morning]).toBeGreaterThan(full.series.sleepPressure[morning] + 0.05);
    expect(short.series.alertness[morning]).toBeLessThan(full.series.alertness[morning] - 0.05);
  });

  it("leaves a day with nothing logged the same as a fresh start by morning", () => {
    const carried = simulate(scenarioOf(carryOver(day(), "2026-11-06")));
    const fresh = simulate({ body, intakes: [], substances: [], events: [], activities: [{ from: 0, posture: "sleeping" }, { from: DAY.wakeMin, posture: "standing" }] });
    for (const name of ["glucose", "insulin", "tg", "alertness", "hunger", "liverGlycogen", "bladderMl"] as const) {
      expect(Math.abs(carried.series[name][12 * 60] - fresh.series[name][12 * 60])).toBeLessThan(Math.abs(fresh.series[name][12 * 60]) * 0.02 + 0.01);
    }
  });

  it("doesn't read a partly logged yesterday as a day of fasting", () => {
    const fresh = simulate({ body, intakes: [], substances: [], events: [], activities: [{ from: 0, posture: "sleeping" }, { from: DAY.wakeMin, posture: "standing" }] });
    const carried = simulate(scenarioOf(carryOver(day({ intakes: [coffee(9 * 60)] }), "2026-11-06")));
    expect(carried.series.liverGlycogen[DAY.wakeMin]).toBeCloseTo(fresh.series.liverGlycogen[DAY.wakeMin], 0);
    expect(carried.series.glucose[DAY.wakeMin]).toBeCloseTo(fresh.series.glucose[DAY.wakeMin], 0);
  });

  it("shows yesterday's food only while it is still doing something", () => {
    const carried = simulate(scenarioOf(carryOver(day({ intakes: [coffee(23 * 60), dinner(13 * 60)] }), "2026-11-06")));
    const ids = (t: number) => processesAt(carried, t).map((p) => p.id);
    expect(ids(DAY.wakeMin)).toContain("intake:coffee@2026-11-05");
    expect(ids(DAY.wakeMin)).not.toContain("intake:dinner@2026-11-05");
    expect(ids(28 * 60)).not.toContain("intake:coffee@2026-11-05");
    expect(threadsAt(carried, DAY.wakeMin).some((thread) => thread.title.includes("offee"))).toBe(true);
  });
});

describe("staying awake", () => {
  it("does nothing for someone already up", () => {
    expect(stayAwake(typicalDayFromYesterday(), 12 * 60)).toBeNull();
  });

  it("keeps someone up past bedtime a little longer, then back to sleep", () => {
    const spans = typicalDayFromYesterday();
    const now = 25 * 60;
    const args = stayAwake(spans, now);
    expect(args).toEqual({ posture: "sitting", from: DAY.sleepMin, until: now + DAY.stillUpMin });
    const state = { activities: spans } as BodyState;
    const next = reduce(state, { name: "set_activity", args: args! }).activities;
    expect(postureAt(next, now + 5)).toBe("sitting");
    expect(postureAt(next, now + DAY.stillUpMin + 5)).toBe("sleeping");
  });

  it("counts someone up early as up from then on", () => {
    const spans = typicalDayFromYesterday();
    const args = stayAwake(spans, 6 * 60);
    const next = reduce({ activities: spans } as BodyState, { name: "set_activity", args: args! }).activities;
    expect(postureAt(next, 6 * 60 + 10)).toBe("sitting");
    expect(postureAt(next, DAY.wakeMin + 10)).toBe("standing");
  });
});

describe("telling it about last night", () => {
  const state = () => ({ activities: typicalDayFromYesterday() }) as BodyState;

  it("takes a late bedtime and a late wake-up", () => {
    const next = reduce(state(), { name: "set_sleep", args: { bed: 90, wake: 9 * 60 } }).activities;
    expect(postureAt(next, -10)).toBe("sitting");
    expect(postureAt(next, 60)).toBe("sitting");
    expect(postureAt(next, 100)).toBe("sleeping");
    expect(postureAt(next, DAY.wakeMin + 10)).toBe("sleeping");
    expect(postureAt(next, 9 * 60 + 10)).toBe("standing");
  });

  it("takes an early night", () => {
    const next = reduce(state(), { name: "set_sleep", args: { bed: -120, wake: 6 * 60 } }).activities;
    expect(postureAt(next, -100)).toBe("sleeping");
    expect(postureAt(next, 6 * 60 + 10)).toBe("standing");
  });
});

describe("correcting what was logged", () => {
  const logged = () => ({ intakes: [dinner(13 * 60)], assumptions: { dinner: "Two plates" } }) as unknown as BodyState;

  it("scales everything in the food", () => {
    const next = reduce(logged(), { name: "correct_intake", args: { id: "dinner", grams: 250, assumption: "One plate" } });
    expect(next.intakes[0]).toMatchObject({ grams: 250, carbsG: 40, fatG: 20, proteinG: 20, fiberG: 3 });
    expect(next.assumptions.dinner).toBe("One plate");
  });

  it("moves it in time without changing it", () => {
    const next = reduce(logged(), { name: "correct_intake", args: { id: "dinner", at: 12 * 60 } });
    expect(next.intakes[0]).toMatchObject({ at: 12 * 60, grams: 500, carbsG: 80 });
  });

  it("names the known ids when the id is wrong", () => {
    expect(() => reduce(logged(), { name: "correct_intake", args: { id: "pizza", grams: 10 } })).toThrow(/dinner/);
  });

  it("redraws the curves", () => {
    const run = (s: BodyState) => simulate({ body, intakes: s.intakes, activities: typicalDayFromYesterday(), substances: [], events: [] });
    const more = run(logged());
    const less = run(reduce(logged(), { name: "correct_intake", args: { id: "dinner", grams: 250 } }));
    expect(less.series.stomachKcal[13 * 60 + 30]).toBeLessThan(more.series.stomachKcal[13 * 60 + 30]);
  });
});
