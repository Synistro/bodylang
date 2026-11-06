import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BodyEvent } from "../model/events";
import { REFERENCE } from "../model/params";
import { Intake, Scenario, simulate, Trajectory } from "../model/simulate";
import { OrganId } from "../model/ids";
import { BLADDER_FULL, bladderCloseup } from "./bladder";
import { brainCloseup } from "./brain";
import { fatCloseup } from "./fat";
import { beatsPerMinute, heartCloseup } from "./heart";
import { KIDNEY_FULL, kidneysCloseup } from "./kidneys";
import { largeIntestineCloseup } from "./largeIntestine";
import { closeupGuidance, closeupOf } from "./list";
import { LIVER_FULL, liverCloseup } from "./liver";
import { breathsPerMinute, lungsCloseup } from "./lungs";
import { ovariesCloseup } from "./ovaries";
import { pancreasCloseup } from "./pancreas";
import { prostateCloseup } from "./prostate";
import { smallIntestineCloseup } from "./smallIntestine";
import { degreesC, spleenCloseup } from "./spleen";
import { stomachCloseup } from "./stomach";
import { uterusCloseup } from "./uterus";

const nothing = { waterMl: 0, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 0, alcoholG: 0 };
const meal: Intake = { ...nothing, id: "lunch", label: "Lunch", at: 13 * 60, grams: 400, waterMl: 200, carbsG: 90, sugarG: 15, fatG: 25, proteinG: 30, fiberG: 6 };
const coffee: Intake = { ...nothing, id: "coffee", label: "Coffee", at: 9 * 60, grams: 240, waterMl: 240, caffeineMg: 150 };
const bigDrink: Intake = { ...nothing, id: "water", label: "Water", at: 10 * 60, grams: 1000, waterMl: 1000 };
const body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const woman = { sex: "female", age: 30, heightCm: 165, weightKg: 60 } as const;
const awake = [{ from: -1440, posture: "sleeping" as const }, { from: 8 * 60, posture: "sitting" as const }];
const day: Scenario = { body, activities: awake, substances: [], intakes: [coffee, meal], events: [] };
const place: { trajectory: Trajectory; muscle: null } = { trajectory: simulate(day), muscle: null };
const running = simulate({ ...day, activities: [...awake, { from: 17 * 60, posture: "running" }, { from: 18 * 60, posture: "sitting" }] });

const event = (over: Partial<BodyEvent> & Pick<BodyEvent, "preset" | "from">): BodyEvent => ({ id: over.preset, label: over.preset, until: null, intensity: 0.8, muscles: [], symptoms: [], custom: null, source: "", ...over });
const coughingFlu = simulate({ ...day, intakes: [], events: [event({ preset: "illness", from: 6 * 60, symptoms: ["fever", "cough"] })] });
const flu = simulate({ ...day, intakes: [], events: [event({ preset: "illness", from: 6 * 60, symptoms: ["fever"] })] });
const drinking = simulate({ ...day, intakes: [bigDrink] });
const afterSex = simulate({ ...day, intakes: [], events: [event({ preset: "sex", from: 21 * 60, until: 21 * 60 + 25 })] });
const cycling = simulate({ body: woman, activities: awake, substances: [], intakes: [], events: [], cycle: { start: 0, lengthDays: 28, periodDays: 5 } });
const inCycle = (days: number) => days * 1440;

const on = (trajectory: Trajectory) => ({ trajectory, muscle: null });

const FROM_THE_DAY = [brainCloseup, stomachCloseup, smallIntestineCloseup, pancreasCloseup, heartCloseup, liverCloseup, lungsCloseup, kidneysCloseup, bladderCloseup, largeIntestineCloseup, fatCloseup, spleenCloseup, uterusCloseup, ovariesCloseup, prostateCloseup];

// Kept as an object so a new organ doesn't compile until it is added here.
const EVERY_ORGAN = Object.keys({ brain: 1, heart: 1, lungs: 1, liver: 1, stomach: 1, pancreas: 1, spleen: 1, small_intestine: 1, large_intestine: 1, kidneys: 1, bladder: 1, muscle: 1, fat: 1, uterus: 1, ovaries: 1, prostate: 1 } satisfies Record<OrganId, number>) as OrganId[];

describe("what each close-up reads from the model", () => {
  it("keeps every level between 0 and 1 all day, whatever the day holds", () => {
    for (const trajectory of [place.trajectory, running, coughingFlu, flu, drinking, afterSex, cycling]) {
      for (const closeup of FROM_THE_DAY) {
        for (let minute = 240; minute <= 1680; minute += 30) {
          for (const level of Object.values<number>(closeup.fromModel(on(trajectory), minute))) {
            expect(level).toBeGreaterThanOrEqual(0);
            expect(level).toBeLessThanOrEqual(1);
          }
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

  it("liver: takes sugar in and fills its store after a meal, and feeds the blood on a run", () => {
    const at = (minute: number) => liverCloseup.fromModel(place, minute);
    expect(at(14 * 60).taking_in).toBeGreaterThan(at(12 * 60).taking_in + 0.05);
    expect(at(16 * 60).store).toBeGreaterThan(at(13 * 60).store);
    expect(at(14 * 60).releasing).toBeLessThan(at(12 * 60).releasing);
    expect(liverCloseup.fromModel(on(running), 17 * 60 + 30).releasing).toBeGreaterThan(at(17 * 60 + 30).releasing * 2);
    expect(at(12 * 60).store * LIVER_FULL.glycogenG).toBeCloseTo(place.trajectory.series.liverGlycogen[12 * 60], 3);
    expect(at(12 * 60).releasing * LIVER_FULL.sugarGPerMin).toBeCloseTo(place.trajectory.series.hepaticOutputGMin[12 * 60], 5);
  });

  it("liver: the fastest flows in any of these days stay on the scale, so the words beside them stay true", () => {
    for (const trajectory of [place.trajectory, running, drinking]) {
      expect(Math.max(...trajectory.series.hepaticOutputGMin)).toBeLessThan(LIVER_FULL.sugarGPerMin);
      expect(Math.max(...trajectory.series.liverUptakeGMin)).toBeLessThan(LIVER_FULL.sugarGPerMin);
    }
  });

  it("lungs: breathes faster on a run, and reads back in breaths", () => {
    const resting = lungsCloseup.fromModel(place, 17 * 60 + 30);
    const onRun = lungsCloseup.fromModel(on(running), 17 * 60 + 30);
    expect(onRun.rate).toBeGreaterThan(resting.rate + 0.2);
    expect(breathsPerMinute(onRun.rate)).toBeCloseTo(running.series.breaths[17 * 60 + 30], 3);
  });

  it("lungs: a cough and an irritated lining come from an illness that has a cough, and from nothing else", () => {
    expect(lungsCloseup.fromModel(place, 12 * 60)).toMatchObject({ irritation: 0, cough: 0 });
    expect(lungsCloseup.fromModel(on(flu), 12 * 60)).toMatchObject({ irritation: 0, cough: 0 });
    expect(lungsCloseup.fromModel(on(coughingFlu), 5 * 60).cough).toBe(0);
    const ill = lungsCloseup.fromModel(on(coughingFlu), 12 * 60);
    expect(ill.cough).toBeGreaterThan(0.5);
    expect(ill.irritation).toBe(ill.cough);
  });

  it("kidneys: make more urine after a big drink, and get less blood on a run", () => {
    const at = (trajectory: Trajectory, minute: number) => kidneysCloseup.fromModel(on(trajectory), minute);
    expect(at(drinking, 11 * 60).urine).toBeGreaterThan(at(place.trajectory, 11 * 60).urine * 2);
    expect(at(running, 17 * 60 + 30).blood).toBeLessThan(at(place.trajectory, 17 * 60 + 30).blood / 2);
    const { bladderMl } = place.trajectory.series;
    expect(at(place.trajectory, 11 * 60).urine * KIDNEY_FULL.urineMlPerMin).toBeCloseTo(bladderMl[11 * 60 + 1] - bladderMl[11 * 60], 3);
  });

  it("bladder: fills through the morning and empties when you go, and more urine arrives after a big drink", () => {
    const at = (minute: number) => bladderCloseup.fromModel(place, minute);
    expect(at(10 * 60).fullness).toBeCloseTo(place.trajectory.series.bladderMl[10 * 60] / BLADDER_FULL.ml, 5);
    expect(bladderCloseup.fromModel(on(drinking), 11 * 60).filling).toBeGreaterThan(at(11 * 60).filling * 2);
    const levels = place.trajectory.series.bladderMl;
    const voided = levels.findIndex((ml, minute) => minute + 1 < levels.length && levels[minute + 1] < ml - 100);
    expect(voided).toBeGreaterThan(-1);
    expect(at(voided + 1).fullness).toBeLessThan(at(voided).fullness - 0.2);
    expect(at(voided).fullness).toBeGreaterThan(at(voided - 60).fullness);
    expect(at(voided).filling).toBe(0);
  });

  it("large intestine: holds nothing before a meal, then holds what wasn't absorbed and draws water back", () => {
    const at = (minute: number) => largeIntestineCloseup.fromModel(place, minute);
    expect(at(12 * 60)).toEqual({ contents: 0, water: 0 });
    expect(at(16 * 60).contents).toBeGreaterThan(0.05);
    expect(at(16 * 60).water).toBeGreaterThan(0.05);
    expect(at(16 * 60).contents).toBeGreaterThan(at(16 * 60).water);
  });

  it("fat: takes fat in after a meal, and otherwise releases a little", () => {
    const at = (minute: number) => fatCloseup.fromModel(place, minute);
    expect(at(12 * 60).taking_in).toBeLessThan(0.001);
    expect(at(12 * 60).releasing).toBeGreaterThan(0);
    expect(at(16 * 60).taking_in).toBeGreaterThan(0.15);
    expect(at(16 * 60).releasing).toBe(0);
  });

  it("spleen: immune cells, germs and temperature all rise with an illness, and read back in degrees", () => {
    const well = spleenCloseup.fromModel(place, 18 * 60);
    const ill = spleenCloseup.fromModel(on(flu), 18 * 60);
    expect(well).toMatchObject({ immune: 0, germs: 0 });
    expect(ill.immune).toBeGreaterThan(0.5);
    expect(ill.germs).toBeGreaterThan(0.5);
    expect(ill.temperature).toBeGreaterThan(well.temperature + 0.1);
    expect(degreesC(ill.temperature)).toBeCloseTo(flu.series.temperature[18 * 60], 3);
    expect(degreesC(ill.temperature)).toBeGreaterThan(REFERENCE.temperature.feverC);
  });

  it("uterus: the lining sheds in a period and rebuilds, and hormones rise after ovulation", () => {
    const at = (days: number) => uterusCloseup.fromModel(on(cycling), inCycle(days));
    expect(at(0.5).shedding).toBe(1);
    expect(at(10).shedding).toBe(0);
    expect(at(4.5).lining).toBeLessThan(at(0.5).lining);
    expect(at(13).lining).toBeGreaterThan(at(5.5).lining);
    expect(at(21).lining).toBeGreaterThan(at(13).lining);
    expect(at(21).hormones).toBeGreaterThan(at(3).hormones * 2);
  });

  it("ovaries: a follicle grows, lets go of an egg along the tube, then makes progesterone", () => {
    const at = (days: number) => ovariesCloseup.fromModel(on(cycling), inCycle(days));
    expect(at(10).follicle).toBeGreaterThan(at(2).follicle);
    expect(at(10)).toMatchObject({ empty_follicle: 0, egg: 0 });
    expect(at(14).egg).toBeGreaterThan(0);
    expect(at(14).egg).toBeLessThan(1);
    expect(at(15.5).egg).toBeGreaterThan(at(14).egg);
    expect(at(20).egg).toBe(1);
    expect(at(20).follicle).toBe(0);
    expect(at(20).empty_follicle).toBe(1);
    expect(at(21).hormones).toBeGreaterThan(at(3).hormones * 2);
  });

  it("reproductive organs rest with no cycle to read", () => {
    const uterus = uterusCloseup.fromModel(place, 12 * 60);
    const ovaries = ovariesCloseup.fromModel(place, 12 * 60);
    expect(uterus.shedding).toBe(0);
    expect(uterus.lining).toBeLessThan(0.5);
    expect(ovaries).toMatchObject({ empty_follicle: 0, egg: 0 });
  });

  it("prostate: works harder after sex, and urine passes only while the bladder empties", () => {
    const at = (trajectory: Trajectory, minute: number) => prostateCloseup.fromModel(on(trajectory), minute);
    expect(at(afterSex, 20 * 60).fluid).toBe(0);
    expect(at(afterSex, 21 * 60 + 30).fluid).toBeGreaterThan(0.3);
    const levels = place.trajectory.series.bladderMl;
    const voided = levels.findIndex((ml, minute) => minute + 1 < levels.length && levels[minute + 1] < ml - 100);
    expect(at(place.trajectory, voided).urine).toBe(1);
    expect(at(place.trajectory, voided + 5).urine).toBe(0);
  });
});

describe("what travels on the body", () => {
  const joints = (JSON.parse(readFileSync(new URL("../../public/assets/body.json", import.meta.url), "utf8")) as { joints: { name: string }[] }).joints.map((joint) => joint.name);

  it("names only levels, organs and joints that exist", () => {
    for (const organ of EVERY_ORGAN) {
      const closeup = closeupOf(organ);
      for (const [key, travel] of Object.entries(closeup?.travels ?? {})) {
        expect(closeup?.keys).toContain(key);
        for (const end of [travel?.from, travel?.to]) expect(["here", ...EVERY_ORGAN]).toContain(end);
        for (const joint of travel?.through ?? []) expect(joints).toContain(joint);
      }
    }
  });

  it("always starts or ends at the place the close-up shows", () => {
    for (const organ of EVERY_ORGAN) {
      for (const travel of Object.values(closeupOf(organ)?.travels ?? {})) expect([travel?.from, travel?.to]).toContain("here");
    }
  });

  it("is offered to Claude for every organ in the body", () => {
    for (const organ of EVERY_ORGAN) {
      expect(closeupOf(organ)?.organ).toBe(organ);
      expect(closeupGuidance()).toContain(`- ${organ}:`);
    }
  });
});
