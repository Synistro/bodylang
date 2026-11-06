import { describe, expect, it } from "vitest";
import { simulate } from "./engine/simulate";
import { value } from "./engine/trajectory";
import { forecast } from "./forecast";
import { CAFFEINE, DAY } from "./params";
import type { Intake, Scenario } from "./scenario";
import { hm, NO_NUTRIENTS } from "./testKit";

const body = { sex: "male" as const, age: 30, heightCm: 180, weightKg: 80 };
const quiet: Scenario = {
  body,
  activities: [
    { from: 0, posture: "sleeping" },
    { from: hm(7), posture: "sitting" },
  ],
  substances: [],
  intakes: [],
  events: [],
};
const food = (id: string, at: number, parts: Partial<Intake>): Intake => ({
  ...NO_NUTRIENTS,
  id,
  label: id,
  at,
  ...parts,
});
const pizza = food("pizza", hm(12), {
  grams: 240,
  waterMl: 110,
  carbsG: 72,
  sugarG: 8,
  fatG: 26,
  proteinG: 28,
  fiberG: 4,
});
const coffee = food("coffee", hm(9), { grams: 250, waterMl: 250, caffeineMg: 200, liquid: true });

describe("what a day ahead looks like", () => {
  it("has nothing coming when you haven't eaten or had coffee", () => {
    const ahead = forecast(simulate(quiet), hm(10));
    expect(ahead).toMatchObject({
      glucosePeak: null,
      glucoseSettles: null,
      stomachHalf: null,
      stomachEmpty: null,
      tgPeak: null,
      caffeineBelowFelt: null,
      caffeineAtBedMgL: 0,
    });
  });

  it("puts a meal's sugar peak ahead of its settling, and its stomach half ahead of empty", () => {
    const ahead = forecast(simulate({ ...quiet, intakes: [pizza] }), hm(12, 5));
    const { glucosePeak, glucoseSettles, stomachHalf, stomachEmpty, tgPeak } = ahead;
    if (!glucosePeak || glucoseSettles === null || stomachHalf === null || stomachEmpty === null || !tgPeak)
      throw new Error("A meal should have all of these ahead");
    expect(glucosePeak.at).toBeGreaterThan(hm(12, 5));
    expect(glucoseSettles).toBeGreaterThan(glucosePeak.at);
    expect(stomachHalf).toBeGreaterThan(hm(12, 5));
    expect(stomachEmpty).toBeGreaterThan(stomachHalf);
    expect(tgPeak.at).toBeGreaterThan(hm(12, 5));
  });

  it("looks only ahead of now", () => {
    const day = simulate({ ...quiet, intakes: [pizza] });
    const before = forecast(day, hm(12, 5));
    const after = forecast(day, hm(20));
    expect(after.glucosePeak?.at ?? hm(20)).toBeGreaterThanOrEqual(hm(20));
    expect(after.tgPeak?.at ?? hm(20)).toBeGreaterThanOrEqual(hm(20));
    expect(before.glucosePeak).not.toBeNull();
  });

  it("names the minute caffeine stops being felt, and what's left at bedtime", () => {
    const day = simulate({ ...quiet, intakes: [coffee] });
    const ahead = forecast(day, hm(10));
    if (ahead.caffeineBelowFelt === null) throw new Error("Coffee should wear off today");
    expect(value(day, "caffeine", ahead.caffeineBelowFelt)).toBeLessThan(CAFFEINE.feltAboveMgL);
    expect(value(day, "caffeine", ahead.caffeineBelowFelt - 1)).toBeGreaterThanOrEqual(CAFFEINE.feltAboveMgL);
    expect(ahead.caffeineAtBedMgL).toBeCloseTo(value(day, "caffeine", DAY.sleepMin), 5);
  });
});
