import { describe, expect, it } from "vitest";
import { BodyEvent, maxHeartRate, muscleStateAt } from "./events";
import { ACTIVITY, ALCOHOL, FASTING, FEEL, GLUCOSE, REFERENCE } from "./params";
import { ActivitySpan, Body, Intake, intakeFlowsAt, ledgerAt, Scenario, simulate, Trajectory, value } from "./simulate";

const none = { grams: 0, waterMl: 0, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 0, alcoholG: 0 };
const hm = (h: number, m = 0) => h * 60 + m;
const mmol = (mgDl: number) => mgDl / REFERENCE.mgDlPerMmolGlucose;
const man: Body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 };
const woman: Body = { sex: "female", age: 62, heightCm: 163, weightKg: 92 };
const wake: ActivitySpan[] = [{ from: 0, posture: "sleeping" }, { from: hm(7, 30), posture: "sitting" }];
const blank = { muscles: [], symptoms: [], custom: null, source: "" };

const scenario = (intakes: Intake[], extra: Partial<Scenario> = {}): Scenario => ({ body: man, activities: wake, substances: [], intakes, events: [], ...extra });
const food = (id: string, at: number, parts: Partial<Intake>): Intake => ({ ...none, id, label: id, at, ...parts });

const peakOf = (series: Float32Array, from: number, to: number) => {
  let at = from;
  for (let t = from; t <= to; t++) if (series[t] > series[at]) at = t;
  return { at, value: series[at] };
};
const lowestOf = (series: Float32Array, from: number, to: number) => {
  let at = from;
  for (let t = from; t <= to; t++) if (series[t] < series[at]) at = t;
  return { at, value: series[at] };
};
// Minutes until the stomach holds under a share of what was eaten.
const stomachBelow = (tr: Trajectory, id: string, at: number, share: number) => {
  const kcal = tr.intakeLedgers.get(id)?.kcal ?? 0;
  for (let m = 0; m < 900; m++) if ((ledgerAt(tr, id, at + m)?.stomach ?? 0) < kcal * share) return m;
  throw new Error("Never emptied");
};
const retained = (tr: Trajectory, id: string, at: number, minutes: number) => (ledgerAt(tr, id, at + minutes)?.stomach ?? 0) / (tr.intakeLedgers.get(id)?.kcal ?? 1);

const AT = hm(8, 30);
const apples = food("apples", AT, { grams: 364, waterMl: 310, carbsG: 50, sugarG: 38, fatG: 0.6, proteinG: 1, fiberG: 9, fructoseShare: 0.6 });
const banana = food("banana", AT, { grams: 120, waterMl: 90, carbsG: 27, sugarG: 14, fatG: 0.4, proteinG: 1.3, fiberG: 3 });
const rice = food("rice", AT, { grams: 250, waterMl: 170, carbsG: 70, fatG: 0.7, proteinG: 7, fiberG: 1 });
const glucoseDrink = food("glucose", AT, { grams: 300, waterMl: 225, carbsG: 75, liquid: true });
const breakfast = food("breakfast", hm(8), { grams: 300, waterMl: 150, carbsG: 60, sugarG: 15, fatG: 10, proteinG: 15, fiberG: 5 });
const fatTest = food("fat", hm(12), { grams: 300, waterMl: 150, carbsG: 25, sugarG: 15, fatG: 75, proteinG: 10 });
const threeMeals = [
  food("breakfast", hm(8), { grams: 350, waterMl: 200, carbsG: 60, sugarG: 15, fatG: 10, proteinG: 15, fiberG: 6 }),
  food("lunch", hm(13), { grams: 500, waterMl: 300, carbsG: 75, sugarG: 10, fatG: 20, proteinG: 30, fiberG: 7 }),
  food("dinner", hm(19), { grams: 550, waterMl: 350, carbsG: 80, sugarG: 10, fatG: 25, proteinG: 35, fiberG: 8 }),
];
const running = (from: number, until: number): ActivitySpan[] => [...wake, { from, posture: "running" }, { from: until, posture: "sitting" }];
const walking = (from: number, until: number): ActivitySpan[] => [...wake, { from, posture: "walking" }, { from: until, posture: "sitting" }];

describe("how fast food leaves, against Tougas 2000 and Benini 1995", () => {
  it("holds a 255 kcal meal inside Tougas's limits for a healthy stomach", () => {
    const meal = food("meal", AT, { grams: 255, waterMl: 150, carbsG: 46, sugarG: 15, fatG: 0.6, proteinG: 15, fiberG: 1.3 });
    const tr = simulate(scenario([meal]));
    expect(retained(tr, "meal", AT, 60)).toBeGreaterThan(0.5);
    expect(retained(tr, "meal", AT, 60)).toBeLessThan(0.9);
    expect(retained(tr, "meal", AT, 120)).toBeLessThan(0.6);
    expect(retained(tr, "meal", AT, 240)).toBeLessThan(0.1);
  });

  it("slows a 870 kcal meal when it has more fibre, in Benini's direction", () => {
    const low = simulate(scenario([food("meal", AT, { grams: 650, waterMl: 350, carbsG: 105.5, sugarG: 15, fatG: 35, proteinG: 37, fiberG: 3.5 })]));
    const high = simulate(scenario([food("meal", AT, { grams: 750, waterMl: 400, carbsG: 119.4, sugarG: 15, fatG: 35, proteinG: 37, fiberG: 17.4 })]));
    expect(stomachBelow(high, "meal", AT, 0.5)).toBeGreaterThan(stomachBelow(low, "meal", AT, 0.5) + 5);
    expect(stomachBelow(low, "meal", AT, 0.5)).toBeGreaterThan(90);
  });

  it("does not count fibre as food", () => {
    const tr = simulate(scenario([apples]));
    const available = (apples.carbsG - apples.fiberG) * 4 + apples.fatG * 9 + apples.proteinG * 4;
    expect(tr.intakeLedgers.get("apples")?.kcal).toBeCloseTo(available, 5);
  });

  it("leaves half of two apples in the stomach for a bit over an hour", () => {
    const tr = simulate(scenario([apples]));
    const half = stomachBelow(tr, "apples", AT, 0.5);
    expect(half).toBeGreaterThan(60);
    expect(half).toBeLessThan(85);
  });
});

describe("what sugar does, against Atkinson 2021 and the glucose tolerance test", () => {
  const peak = (intake: Intake, body: Body = man) => {
    const tr = simulate({ ...scenario([intake]), body });
    const p = peakOf(tr.series.glucose, intake.at, intake.at + 300);
    return { mmol: mmol(p.value), after: p.at - intake.at, tr };
  };

  it("peaks two apples about 6.0 at about 70 minutes", () => {
    const p = peak(apples);
    expect(p.mmol).toBeGreaterThan(5.7);
    expect(p.mmol).toBeLessThan(6.2);
    expect(p.after).toBeGreaterThan(60);
    expect(p.after).toBeLessThan(85);
  });

  it("peaks a banana about 6.1", () => {
    expect(peak(banana).mmol).toBeGreaterThan(5.9);
    expect(peak(banana).mmol).toBeLessThan(6.4);
  });

  it("peaks a plate of white rice about 7.7, under the after-meal cutoff", () => {
    expect(peak(rice).mmol).toBeGreaterThan(7.4);
    expect(peak(rice).mmol).toBeLessThan(7.9);
  });

  it("peaks 75 g of glucose about 8.6 at about 40 minutes, about 5.8 at two hours", () => {
    const p = peak(glucoseDrink);
    expect(p.mmol).toBeCloseTo(8.6, 0);
    expect(p.after).toBeGreaterThan(30);
    expect(p.after).toBeLessThan(50);
    expect(mmol(value(p.tr, "glucose", AT + 120))).toBeCloseTo(5.8, 0);
  });

  it("lets more of whole fruit's sugar skip the blood when its fructose share is higher", () => {
    expect(peak({ ...apples, fructoseShare: 0.67 }).mmol).toBeLessThan(peak({ ...apples, fructoseShare: 0.5 }).mmol);
  });
});

describe("running and walking", () => {
  const fed = simulate(scenario([breakfast], { activities: running(hm(10), hm(11)) }));
  const fasted = simulate(scenario([], { activities: running(hm(10), hm(11)) }));

  it("keeps sugar near 4.5 through a run two hours after breakfast", () => {
    const lowest = mmol(lowestOf(fed.series.glucose, hm(10), hm(12)).value);
    expect(lowest).toBeGreaterThan(4.3);
    expect(lowest).toBeLessThan(4.8);
  });

  it("keeps sugar near 4.6 through a fasted run, and pays for it from the liver", () => {
    const lowest = mmol(lowestOf(fasted.series.glucose, hm(10), hm(12)).value);
    expect(lowest).toBeGreaterThan(4.3);
    expect(lowest).toBeLessThan(4.8);
    const plain = simulate(scenario([]));
    expect(value(plain, "liverGlycogen", hm(11)) - value(fasted, "liverGlycogen", hm(11))).toBeGreaterThan(15);
  });

  it("still lowers a meal's peak with a walk, without driving sugar low", () => {
    const meal = { ...breakfast, at: hm(13) };
    const sat = simulate(scenario([meal]));
    const walked = simulate(scenario([meal], { activities: walking(hm(13, 30), hm(14)) }));
    expect(peakOf(walked.series.glucose, hm(13), hm(17)).value).toBeLessThan(peakOf(sat.series.glucose, hm(13), hm(17)).value - 5);
    expect(mmol(lowestOf(walked.series.glucose, hm(13, 30), hm(17)).value)).toBeGreaterThan(4.3);
  });

  it("never lets glycogen go negative, and keeps its floor under what reads as very low", () => {
    const allDay = simulate(scenario([], { activities: running(hm(8), hm(20)) }));
    expect(Math.min(...allDay.series.muscleGlycogen)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...allDay.series.liverGlycogen)).toBeGreaterThanOrEqual(0);
    expect(mmol(GLUCOSE.floorMgDl)).toBeLessThan(REFERENCE.glucose.veryLowMmol);
  });

  it("sets heart rate from reserve, 70% running and 30% walking, and caps it at your maximum", () => {
    const reserve = (tr: Trajectory, t: number, rest: number, age: number) => (value(tr, "hr", t) - rest) / (maxHeartRate(age) - rest);
    expect(reserve(fasted, hm(10, 30), fasted.anthro.restingBpm, 30)).toBeCloseTo(ACTIVITY.heartReserve.running, 1);
    const walk = simulate(scenario([], { activities: walking(hm(10), hm(11)) }));
    expect(reserve(walk, hm(10, 30), walk.anthro.restingBpm, 30)).toBeCloseTo(ACTIVITY.heartReserve.walking, 1);
    const older = simulate({ ...scenario([], { activities: running(hm(10), hm(11)) }), body: woman });
    expect(value(older, "hr", hm(10, 30))).toBeLessThan(150);
    expect(Math.max(...older.series.hr)).toBeLessThanOrEqual(maxHeartRate(62));
  });

  it("drops heart rate with a half-life of 3 to 5 minutes after you stop", () => {
    const rest = value(fasted, "hr", hm(9, 50));
    const excess = (t: number) => value(fasted, "hr", t) - rest;
    expect(excess(hm(11) + 3) / excess(hm(11))).toBeGreaterThan(0.5);
    expect(excess(hm(11) + 5) / excess(hm(11))).toBeLessThan(0.5);
  });

  it("makes you sweat, heat up and raises pressure", () => {
    const plain = simulate(scenario([]));
    const sweatPerMin = -(value(fasted, "fluidBalance", hm(10, 50)) - value(fasted, "fluidBalance", hm(10, 30))) / 20;
    expect(sweatPerMin).toBeGreaterThan(15);
    expect(sweatPerMin).toBeLessThan(21);
    const warmer = value(fasted, "temperature", hm(10, 50)) - value(plain, "temperature", hm(10, 50));
    expect(warmer).toBeGreaterThan(1.2);
    expect(warmer).toBeLessThan(1.5);
    const pressure = value(fasted, "systolic", hm(10, 30)) - value(plain, "systolic", hm(10, 30));
    expect(pressure).toBeGreaterThan(50);
    expect(pressure).toBeLessThan(60);
    const walk = simulate(scenario([], { activities: walking(hm(10), hm(11)) }));
    expect(value(walk, "systolic", hm(10, 30)) - value(plain, "systolic", hm(10, 30))).toBeGreaterThan(15);
    expect(value(walk, "temperature", hm(10, 50)) - value(plain, "temperature", hm(10, 50))).toBeLessThan(0.3);
  });

  it("makes your legs sore from a run, and nothing from a walk", () => {
    const soreLater = muscleStateAt(fasted.muscleEvents, "quads", hm(26)).soreness;
    expect(soreLater).toBeGreaterThan(0.1);
    expect(muscleStateAt(fasted.muscleEvents, "chest", hm(26)).soreness).toBe(0);
    const walk = simulate(scenario([], { activities: walking(hm(10), hm(11)) }));
    expect(muscleStateAt(walk.muscleEvents, "quads", hm(26)).soreness).toBe(0);
  });

  it("sends a hard run's blood to the muscles and away from the gut, as ter Steege reviews", () => {
    expect(value(fed, "flowMuscle", hm(10, 30))).toBeGreaterThan(0.6);
    const flowAt = (tr: Trajectory, t: number) => value(tr, "flowGut", t) * value(tr, "cardiacOutput", t);
    const rest = simulate(scenario([]));
    expect(flowAt(fasted, hm(10, 30)) / flowAt(rest, hm(10, 30))).toBeLessThan(0.5);
  });

  it("burns by body mass: what a posture adds over rest is METs times kilograms", () => {
    const metsFrom = (tr: Trajectory, t: number, body: Body) => (value(tr, "kcalPerHour", t) - tr.anthro.bmrKcalPerDay / 24) / body.weightKg + 1;
    expect(metsFrom(fasted, hm(10, 30), man)).toBeCloseTo(8.5, 0);
    const heavier = simulate({ ...scenario([], { activities: running(hm(10), hm(11)) }), body: woman });
    expect(metsFrom(heavier, hm(10, 30), woman)).toBeCloseTo(8.5, 0);
    expect(value(heavier, "kcalPerHour", hm(10, 30))).toBeGreaterThan(value(fasted, "kcalPerHour", hm(10, 30)));
  });
});

describe("alertness through a day", () => {
  const fed = simulate(scenario(threeMeals));
  const night: BodyEvent = { ...blank, id: "night", label: "Short night", preset: "poor_sleep", from: hm(7), until: null, intensity: 1 };
  const shortSleep: ActivitySpan[] = [{ from: 0, posture: "sitting" }, { from: hm(3), posture: "sleeping" }, { from: hm(7), posture: "sitting" }];

  it("sits near 40 at 14:30 and 43 at 20:30 on a normal day", () => {
    expect(value(fed, "alertness", hm(14, 30))).toBeCloseTo(0.4, 1);
    expect(value(fed, "alertness", hm(20, 30))).toBeCloseTo(0.43, 1);
  });

  it("reads near 17 at 15:00 after a short night, between the two ways of logging one", () => {
    const logged = simulate(scenario(threeMeals, { events: [{ ...night, from: hm(7, 30) }] }));
    const slept = simulate(scenario(threeMeals, { activities: shortSleep, events: [night] }));
    expect(value(logged, "alertness", hm(15))).toBeGreaterThan(0.17);
    expect(value(logged, "alertness", hm(15))).toBeLessThan(0.25);
    expect(value(slept, "alertness", hm(15))).toBeGreaterThan(0.1);
    expect(value(slept, "alertness", hm(15))).toBeLessThan(0.17);
  });

  it("is never zero while you are awake", () => {
    const slept = simulate(scenario([], { activities: shortSleep, events: [night] }));
    for (let t = hm(7); t < hm(23, 30); t++) expect(slept.series.alertness[t]).toBeGreaterThanOrEqual(FEEL.alertnessFloorAwake - 1e-6);
  });

  it("carries yesterday's waking hours, and counts awake time from when you woke", () => {
    expect(value(fed, "hoursAwake", hm(8, 30))).toBeCloseTo(1, 0);
    expect(value(fed, "sleepPressure", hm(23))).toBeGreaterThan(value(fed, "sleepPressure", hm(9)));
    const slept = simulate(scenario([], { activities: shortSleep }));
    expect(value(slept, "sleepPressure", hm(8))).toBeGreaterThan(value(simulate(scenario([])), "sleepPressure", hm(8)));
  });
});

describe("blood fat, against the Kolovou 2011 fat tolerance test", () => {
  it("peaks a 75 g fat test near 200 about three hours on, and clears it by 12", () => {
    const tr = simulate(scenario([fatTest]));
    const p = peakOf(tr.series.tg, hm(12), hm(23));
    expect(p.value).toBeGreaterThan(180);
    expect(p.value).toBeLessThan(220);
    expect((p.at - hm(12)) / 60).toBeGreaterThan(2.5);
    expect((p.at - hm(12)) / 60).toBeLessThan(4.5);
    expect(value(tr, "tg", hm(24))).toBeLessThan(tr.anthro.baselineTg + 10);
  });

  it("starts an older, heavier body higher", () => {
    const tr = simulate({ ...scenario([fatTest]), body: woman });
    expect(tr.anthro.baselineTg).toBeGreaterThan(simulate(scenario([])).anthro.baselineTg);
    expect(peakOf(tr.series.tg, hm(12), hm(23)).value).toBeGreaterThan(200);
  });
});

describe("water, against Ratnatunga 1991", () => {
  it("reads about -1.1 L by the end of a day with nothing drunk", () => {
    const tr = simulate(scenario([]));
    expect(value(tr, "fluidBalance", hm(23))).toBeLessThan(-1000);
    expect(value(tr, "fluidBalance", hm(23))).toBeGreaterThan(-1200);
  });

  it("reads less than half of that on three ordinary meals", () => {
    const tr = simulate(scenario(threeMeals));
    expect(value(tr, "fluidBalance", hm(23))).toBeGreaterThan(-500);
  });
});

describe("a long stretch of stress, a fast and a drink", () => {
  it("drifts sugar down about 0.5 and insulin to about 0.6 by 24 hours of fasting, and plateaus hunger", () => {
    const tr = simulate(scenario([]));
    const start = value(tr, "glucose", hm(7));
    expect(mmol(start - value(tr, "glucose", hm(24)))).toBeCloseTo(0.5, 0);
    expect(value(tr, "insulin", hm(24)) / value(tr, "insulin", hm(7))).toBeCloseTo(1 - FASTING.insulinDropShare, 0);
    expect(Math.max(...tr.series.hunger.slice(hm(8), hm(23)))).toBeLessThanOrEqual(FEEL.hungerPlateau + 1e-6);
  });

  it("starts the drift afresh once you eat", () => {
    const tr = simulate(scenario([food("snack", hm(17), { grams: 100, waterMl: 50, carbsG: 25, sugarG: 10, fatG: 5, proteinG: 5 })]));
    expect(value(tr, "glucose", hm(23))).toBeGreaterThan(value(simulate(scenario([])), "glucose", hm(23)));
  });

  it("peaks a 0.5 g/kg beer inside Mitchell 2014's range", () => {
    const beers = food("beer", hm(19), { grams: 800, waterMl: 760, carbsG: 28, alcoholG: 41.3, liquid: true });
    const tr = simulate({ ...scenario([beers]), body: { ...man, weightKg: 82.66 } });
    const p = peakOf(tr.series.alcohol, hm(19), hm(23));
    expect(p.value).toBeGreaterThan(0.503 - 0.098);
    expect(p.value).toBeLessThan(0.503 + 0.098);
    expect(p.at - hm(19)).toBeGreaterThan(62 - 23);
    expect(p.at - hm(19)).toBeLessThan(62 + 23);
  });

  it("clears alcohol about 1.3 times as fast after food, as Ramchandani measured", () => {
    const spirit = food("spirit", hm(19), { grams: 150, waterMl: 110, alcoholG: 40, liquid: true });
    const empty = simulate(scenario([spirit]));
    const fed = simulate(scenario([spirit, food("meal", hm(19), { grams: 500, waterMl: 200, carbsG: 80, sugarG: 10, fatG: 30, proteinG: 30, fiberG: 5 })]));
    // Both read as the liver's own rate at the same blood level, with what is still arriving taken out.
    const litres = ALCOHOL.widmarkMale * man.weightKg;
    const liverRateAtLevel = (tr: Trajectory, level: number) => {
      const peak = peakOf(tr.series.alcohol, hm(19), hm(24)).at;
      let t = peak;
      while (value(tr, "alcohol", t) > level) t++;
      const absorbed = (at: number) => intakeFlowsAt(tr, "spirit", at)?.alcoholAbsorbed ?? 0;
      return absorbed(t + 15) - absorbed(t - 15) - (value(tr, "alcohol", t + 15) - value(tr, "alcohol", t - 15)) * litres;
    };
    const ratio = liverRateAtLevel(fed, 0.2) / liverRateAtLevel(empty, 0.2);
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.45);
  });
});
