import { describe, expect, it } from "vitest";
import { reduce, BodyState } from "../actions/reduce";
import { assess } from "./assess/assess";
import { hasSomethingToSay } from "./assess/types";
import { crampLevel, Cycle, cycleDay, cyclePhase, daysIntoCycle, hormonesAt, liningShare, minutesToNextPeriod } from "./cycle";
import { carryOver, firstDay } from "./day";
import { CYCLE, DAY } from "./params";
import { processesAt } from "./processes/processes";
import { simulate } from "./engine/simulate";

const woman = { sex: "female", age: 30, heightCm: 168, weightKg: 62 } as const;
const man = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const wake = [{ from: 0, posture: "sleeping" }, { from: DAY.wakeMin, posture: "standing" }] as const;

// Today is the given day of a 28-day cycle.
const onDay = (day: number): Cycle => ({ start: -(day - 1) * 1440, lengthDays: 28, periodDays: 5 });
const dayOf = (cycle: Cycle | null) => simulate({ body: woman, intakes: [], activities: [...wake], substances: [], events: [], cycle });
const NOON = 12 * 60;

describe("the phases of a cycle", () => {
  it("counts days from the date you gave, across as many cycles as have passed", () => {
    expect(cycleDay(onDay(1), NOON)).toBe(1);
    expect(cycleDay(onDay(18), NOON)).toBe(18);
    expect(cycleDay({ start: -(28 + 2) * 1440, lengthDays: 28, periodDays: 5 }, NOON)).toBe(3);
    expect(daysIntoCycle(onDay(1), -1440 + NOON)).toBeCloseTo(27.5 - 0, 0);
  });

  it("names each phase, with ovulation 14 days before the next period", () => {
    expect(cyclePhase(onDay(2), NOON)).toBe("period");
    expect(cyclePhase(onDay(9), NOON)).toBe("follicular");
    expect(cyclePhase(onDay(15), NOON)).toBe("ovulation");
    expect(cyclePhase(onDay(22), NOON)).toBe("luteal");
    expect(cyclePhase({ start: -21 * 1440, lengthDays: 35, periodDays: 5 }, NOON)).toBe("ovulation");
  });

  it("counts down to the next period", () => {
    expect(minutesToNextPeriod(onDay(26), 0) / 1440).toBeCloseTo(3, 1);
  });
});

describe("the hormones, against Stricker 2006", () => {
  const at = (day: number) => hormonesAt(onDay(day), NOON);

  it("keeps progesterone under 3 nmol/L before ovulation, and over 30 in the middle of the luteal phase", () => {
    expect(at(8).progesterone).toBeLessThan(3);
    expect(at(21).progesterone).toBeGreaterThan(30);
    expect(at(21).progesterone).toBeLessThan(55);
  });

  it("peaks estrogen just before ovulation, then a smaller second rise", () => {
    expect(at(14).estradiol).toBeGreaterThan(800);
    expect(at(14).estradiol).toBeLessThan(1300);
    expect(at(21).estradiol).toBeGreaterThan(at(8).estradiol);
    expect(at(21).estradiol).toBeLessThan(at(14).estradiol);
  });

  it("surges LH for about a day around ovulation", () => {
    expect(hormonesAt(onDay(15), -0.5 * 1440).lh).toBeGreaterThan(30);
    expect(at(8).lh).toBeLessThan(10);
    expect(at(21).lh).toBeLessThan(10);
  });

  it("runs smoothly from one cycle into the next", () => {
    const cycle = onDay(1);
    const before = hormonesAt(cycle, -1);
    const after = hormonesAt(cycle, 1);
    expect(Math.abs(before.progesterone - after.progesterone)).toBeLessThan(0.1);
    expect(Math.abs(before.estradiol - after.estradiol)).toBeLessThan(1);
  });
});

describe("what a cycle changes in the rest of the body", () => {
  const follicular = dayOf(onDay(9));
  const luteal = dayOf(onDay(21));
  const none = dayOf(null);

  it("warms the luteal phase by about 0.3 °C", () => {
    const rise = luteal.series.temperature[NOON] - follicular.series.temperature[NOON];
    expect(rise).toBeGreaterThan(0.25);
    expect(rise).toBeLessThan(0.45);
  });

  it("raises resting heart rate by about 3 bpm", () => {
    const rise = luteal.series.hr[NOON] - follicular.series.hr[NOON];
    expect(rise).toBeGreaterThan(2);
    expect(rise).toBeLessThan(4);
  });

  it("leaves the same meal higher in the luteal phase, because insulin works less well", () => {
    const meal = { id: "meal", label: "Meal", at: 13 * 60, grams: 300, waterMl: 150, carbsG: 70, sugarG: 10, fatG: 8, proteinG: 15, fiberG: 3, caffeineMg: 0, alcoholG: 0 };
    const withMeal = (cycle: Cycle) => simulate({ body: woman, intakes: [meal], activities: [...wake], substances: [], events: [], cycle });
    const peak = (cycle: Cycle) => Math.max(...withMeal(cycle).series.glucose.slice(13 * 60, 16 * 60));
    expect(peak(onDay(21))).toBeGreaterThan(peak(onDay(9)));
    expect(peak(onDay(21)) - peak(onDay(9))).toBeLessThan(10);
  });

  it("changes nothing for someone with no cycle logged", () => {
    expect(none.series.temperature[NOON]).toBeCloseTo(simulate({ body: woman, intakes: [], activities: [...wake], substances: [], events: [] }).series.temperature[NOON], 5);
    expect(none.series.estradiol[NOON]).toBe(0);
  });

  it("ignores a cycle on a body without the anatomy for one", () => {
    const tr = simulate({ body: man, intakes: [], activities: [...wake], substances: [], events: [], cycle: onDay(21) });
    expect(tr.cycle).toBeNull();
    expect(tr.series.progesterone[NOON]).toBe(0);
  });
});

describe("how it reads", () => {
  const readings = (cycle: Cycle | null) => assess(dayOf(cycle), NOON).readings;
  const find = (cycle: Cycle | null, id: string) => readings(cycle).find((r) => r.id === id);

  it("shows the cycle's readings only once one is logged", () => {
    for (const id of ["cycleDay", "estradiol", "progesterone"]) {
      expect(hasSomethingToSay(find(null, id)!)).toBe(false);
      expect(hasSomethingToSay(find(onDay(21), id)!)).toBe(true);
    }
  });

  it("gives the day, the phase and the next period", () => {
    const day = find(onDay(21), "cycleDay")!;
    expect(day.display).toBe("21");
    expect(day.verdictWord).toBe("Luteal phase");
    expect(day.forecast).toMatch(/Next period in about 8 days/);
    expect(day.source).toMatch(/can't be used for contraception/);
  });

  it("never paints an ordinary cycle as a problem", () => {
    for (let day = 1; day <= 28; day++) {
      for (const r of readings(onDay(day))) if (["cycleDay", "estradiol", "progesterone", "temperature", "hr"].includes(r.id)) expect(r.tone).toBe("calm");
    }
  });

  it("names the cycle as a reason for a warmer body", () => {
    expect(find(onDay(21), "temperature")?.why).toMatch(/cycle/);
  });

  it("offers cramps at the start of a period only", () => {
    expect(crampLevel(onDay(1), NOON)).toBeGreaterThan(crampLevel(onDay(4), NOON));
    expect(crampLevel(onDay(9), NOON)).toBe(0);
    expect(assess(dayOf(onDay(1)), NOON).feelings.map((f) => f.id)).toContain("cramps");
    expect(assess(dayOf(onDay(9)), NOON).feelings.map((f) => f.id)).not.toContain("cramps");
  });

  it("thins the lining through a period and thickens it after", () => {
    expect(liningShare(onDay(5), NOON)).toBeLessThan(liningShare(onDay(1), NOON));
    expect(liningShare(onDay(14), NOON)).toBeGreaterThan(liningShare(onDay(7), NOON));
    expect(liningShare(onDay(26), NOON)).toBeGreaterThan(liningShare(onDay(14), NOON));
  });

  it("draws a line from the brain to the uterus only when there is a cycle", () => {
    expect(processesAt(dayOf(null), NOON).map((p) => p.id)).not.toContain("cycle");
    const line = processesAt(dayOf(onDay(21)), NOON).find((p) => p.id === "cycle");
    expect(line?.stops.map((s) => s.organ)).toEqual(["brain", "ovaries", "uterus"]);
    expect(line?.headline).toContain("Day 21 of 28");
  });
});

describe("telling it", () => {
  const state = () => ({ cycle: null }) as BodyState;

  it("uses a usual cycle unless told otherwise", () => {
    expect(reduce(state(), { name: "set_cycle", args: { last_start: -4320 } }).cycle).toEqual({ start: -4320, lengthDays: CYCLE.lengthDays, periodDays: CYCLE.periodDays });
  });

  it("keeps a length it was told, across a new start date", () => {
    const told = reduce(state(), { name: "set_cycle", args: { last_start: -4320, length_days: 32 } });
    expect(reduce(told, { name: "set_cycle", args: { last_start: 480 } }).cycle?.lengthDays).toBe(32);
  });

  it("clears it", () => {
    const told = reduce(state(), { name: "set_cycle", args: { last_start: -4320 } });
    expect(reduce(told, { name: "set_cycle", args: { last_start: null } }).cycle).toBeNull();
  });

  it("stays on the same day of the cycle across a new date", () => {
    const doc = { ...firstDay("2026-11-05", woman), cycle: onDay(20) };
    const next = carryOver(doc, "2026-11-06");
    expect(cycleDay(next.cycle!, NOON)).toBe(21);
  });
});
