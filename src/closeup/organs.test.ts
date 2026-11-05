import { describe, expect, it } from "vitest";
import { Intake, Scenario, simulate, Trajectory } from "../model/simulate";
import { brainCloseup } from "./brain";
import { beatsPerMinute, heartCloseup } from "./heart";
import { closeupGuidance, closeupOf } from "./list";
import { pancreasCloseup } from "./pancreas";
import { smallIntestineCloseup } from "./smallIntestine";
import { stomachCloseup } from "./stomach";

const nothing = { waterMl: 0, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 0, alcoholG: 0 };
const meal: Intake = { ...nothing, id: "lunch", label: "Lunch", at: 13 * 60, grams: 400, waterMl: 200, carbsG: 90, sugarG: 15, fatG: 25, proteinG: 30, fiberG: 6 };
const coffee: Intake = { ...nothing, id: "coffee", label: "Coffee", at: 9 * 60, grams: 240, waterMl: 240, caffeineMg: 150 };
const body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const awake = [{ from: -1440, posture: "sleeping" as const }, { from: 8 * 60, posture: "sitting" as const }];
const day: Scenario = { body, activities: awake, substances: [], intakes: [coffee, meal], events: [] };
const place: { trajectory: Trajectory; muscle: null } = { trajectory: simulate(day), muscle: null };
const running = simulate({ ...day, activities: [...awake, { from: 17 * 60, posture: "running" }, { from: 18 * 60, posture: "sitting" }] });

describe("what each close-up reads from the model", () => {
  it("keeps every level between 0 and 1 all day", () => {
    for (const closeup of [brainCloseup, stomachCloseup, smallIntestineCloseup, pancreasCloseup, heartCloseup]) {
      for (let minute = 240; minute <= 1680; minute += 30) {
        for (const level of Object.values<number>(closeup.fromModel(place, minute))) {
          expect(level).toBeGreaterThanOrEqual(0);
          expect(level).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("brain: caffeine takes seats after a coffee, and the tired signal builds through the day", () => {
    const at = (minute: number) => brainCloseup.fromModel(place, minute);
    expect(at(8 * 60 + 30).caffeine).toBeLessThan(0.02);
    expect(at(10 * 60).caffeine).toBeGreaterThan(0.1);
    expect(at(22 * 60).tired).toBeGreaterThan(at(9 * 60).tired);
  });

  it("stomach: fills with the meal, then empties", () => {
    const at = (minute: number) => stomachCloseup.fromModel(place, minute);
    expect(at(13 * 60 - 10).food).toBe(0);
    expect(at(13 * 60 + 5).fullness).toBeGreaterThan(0.2);
    expect(at(13 * 60 + 5).food).toBeGreaterThan(0.2);
    expect(at(13 * 60 + 60).emptying).toBeGreaterThan(0);
    expect(at(20 * 60).food).toBeLessThan(at(13 * 60 + 5).food);
  });

  it("small intestine: absorbs after the stomach starts emptying", () => {
    const at = (minute: number) => smallIntestineCloseup.fromModel(place, minute);
    expect(at(12 * 60).sugar).toBe(0);
    expect(at(14 * 60).sugar).toBeGreaterThan(0.05);
    expect(at(14 * 60).fat).toBeGreaterThan(0);
    expect(at(14 * 60).food).toBeGreaterThan(0);
  });

  it("pancreas: releases more insulin after the meal, as sugar rises", () => {
    const at = (minute: number) => pancreasCloseup.fromModel(place, minute);
    expect(at(14 * 60).insulin).toBeGreaterThan(at(12 * 60).insulin);
    expect(at(14 * 60).sugar).toBeGreaterThan(at(12 * 60).sugar);
  });

  it("heart: beats faster and sends more blood to the muscles on a run, and reads back in beats", () => {
    const resting = heartCloseup.fromModel(place, 17 * 60 + 30);
    const onRun = heartCloseup.fromModel({ trajectory: running, muscle: null }, 17 * 60 + 30);
    expect(onRun.rate).toBeGreaterThan(resting.rate);
    expect(onRun.muscle).toBeGreaterThan(resting.muscle);
    expect(beatsPerMinute(resting.rate)).toBeCloseTo(place.trajectory.series.hr[17 * 60 + 30], 1);
  });
});

describe("what travels on the body", () => {
  it("names only levels and organs the close-up has", () => {
    for (const closeup of [brainCloseup, stomachCloseup, smallIntestineCloseup, pancreasCloseup, heartCloseup]) {
      for (const key of Object.keys(closeup.travels)) expect(closeup.keys).toContain(key);
    }
  });

  it("is offered to Claude for every organ on the list", () => {
    for (const organ of ["brain", "stomach", "small_intestine", "pancreas", "heart"] as const) {
      expect(closeupOf(organ)?.organ).toBe(organ);
      expect(closeupGuidance()).toContain(`- ${organ}:`);
    }
  });
});
