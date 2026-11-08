import { describe, expect, it } from "vitest";
import { CAFFEINE, GLUCOSE, INSULIN, LABS } from "./params";
import { simulate } from "./engine/simulate";
import { foodKcalOf, Scenario } from "./scenario";
import { caffeineLedgerAt, ledgerAt, LEDGER_KEYS, value } from "./engine/trajectory";
import { NO_NUTRIENTS } from "./testKit";

const body = { sex: "male" as const, age: 30, heightCm: 178, weightKg: 75 };
const awake = [
  { from: 0, posture: "sleeping" as const },
  { from: 450, posture: "sitting" as const },
];
const peakOf = (s: Float32Array, from: number, to: number) => {
  let best = from;
  for (let t = from; t <= to; t++) if (s[t] > s[best]) best = t;
  return { at: best, value: s[best] };
};

describe("caffeine", () => {
  const scenario: Scenario = {
    body,
    activities: awake,
    substances: [],
    intakes: [{ ...NO_NUTRIENTS, id: "c", label: "coffee", at: 510, grams: 250, waterMl: 245, caffeineMg: 95 }],
  };
  const tr = simulate(scenario);

  it("peaks within about an hour", () => {
    const p = peakOf(tr.series.caffeine, 510, 800);
    expect(p.at - 510).toBeGreaterThan(30);
    expect(p.at - 510).toBeLessThan(90);
  });

  it("falls by half over one published half-life", () => {
    const p = peakOf(tr.series.caffeine, 510, 800);
    const later = value(tr, "caffeine", p.at + CAFFEINE.halfLifeH.mid * 60);
    expect(later / p.value).toBeGreaterThan(0.45);
    expect(later / p.value).toBeLessThan(0.56);
  });

  it("accounts for every milligram", () => {
    const l = caffeineLedgerAt(tr, "c", 900)!;
    expect(l.stomach + l.intestine + l.blood + l.cleared).toBeCloseTo(95, 0);
  });
});

describe("glucose", () => {
  const ogtt = simulate({
    body,
    activities: awake,
    substances: [],
    intakes: [
      {
        ...NO_NUTRIENTS,
        id: "o",
        label: "75 g glucose",
        at: 540,
        grams: 300,
        waterMl: 225,
        carbsG: 75,
        sugarG: 0,
        liquid: true,
      },
    ],
  });

  it("reproduces a healthy oral glucose tolerance curve", () => {
    const p = peakOf(ogtt.series.glucose, 540, 800);
    expect(p.value).toBeGreaterThan(125);
    expect(p.value).toBeLessThan(175);
    expect(p.at - 540).toBeGreaterThan(25);
    expect(p.at - 540).toBeLessThan(80);
    expect(value(ogtt, "glucose", 540 + 120)).toBeLessThan(140); // WHO cutoff for normal at 2 h
  });

  it("peaks higher for a body whose panel shows insulin resistance, and not for a reference panel", () => {
    const peakWith = (labs?: Scenario["body"]["labs"]) =>
      peakOf(simulate({ ...ogtt.scenario, body: { ...body, labs } }).series.glucose, 540, 800).value;
    const without = peakWith();
    expect(peakWith({ fastingGlucoseMmol: 6.1, fastingInsulinUuMl: 18 })).toBeGreaterThan(without);
    const reference = peakWith({
      fastingGlucoseMmol: GLUCOSE.baselineMgDl / LABS.mgDlPerMmolGlucose,
      fastingInsulinUuMl: INSULIN.baselineUUPerMl,
    });
    expect(Math.abs(reference / without - 1)).toBeLessThan(0.02);
  });

  it("releases insulin into a plausible range", () => {
    const p = peakOf(ogtt.series.insulin, 540, 800);
    expect(p.value).toBeGreaterThan(30);
    expect(p.value).toBeLessThan(110);
  });

  it("walking after a meal lowers the glucose load compared with sitting", () => {
    const meal = {
      ...NO_NUTRIENTS,
      id: "m",
      label: "meal",
      at: 780,
      grams: 400,
      waterMl: 150,
      carbsG: 90,
      sugarG: 20,
      fatG: 25,
      proteinG: 25,
    };
    const sit = simulate({ body, activities: awake, substances: [], intakes: [meal] });
    const walk = simulate({
      body,
      activities: [...awake, { from: 790, posture: "walking" }, { from: 820, posture: "sitting" }],
      substances: [],
      intakes: [meal],
    });
    const area = (s: Float32Array) => s.slice(780, 960).reduce((a, b) => a + (b - 88), 0);
    expect(area(walk.series.glucose)).toBeLessThan(area(sit.series.glucose) * 0.85);
    expect(peakOf(walk.series.glucose, 780, 960).value).toBeLessThan(peakOf(sit.series.glucose, 780, 960).value - 3);
  });

  it("a heavier, older body handles the same load worse", () => {
    const other = simulate({ ...ogtt.scenario, body: { sex: "male", age: 60, heightCm: 178, weightKg: 105 } });
    expect(peakOf(other.series.glucose, 540, 800).value).toBeGreaterThan(peakOf(ogtt.series.glucose, 540, 800).value);
  });
});

describe("absorbing sugar", () => {
  it("adds up to everything digestible in the food, liver's share included", () => {
    const rice = {
      ...NO_NUTRIENTS,
      id: "rice",
      label: "White rice",
      at: 720,
      grams: 250,
      waterMl: 170,
      carbsG: 70,
      fatG: 0.7,
      proteinG: 7,
      fiberG: 1,
    };
    const tr = simulate({ body, activities: awake, substances: [], intakes: [rice] });
    let grams = 0;
    for (let t = 720; t < 1800; t++) grams += tr.series.carbAbsorbMgMin[t] / 1000;
    expect(grams).toBeGreaterThan(60);
    expect(grams).toBeLessThanOrEqual(69);
  });
});

describe("a 900 kcal mixed meal", () => {
  const meal = {
    ...NO_NUTRIENTS,
    id: "p",
    label: "pizza",
    at: 1000,
    grams: 300,
    waterMl: 110,
    carbsG: 100,
    sugarG: 30,
    fatG: 38,
    proteinG: 32,
    fiberG: 5,
  };
  const tr = simulate({ body, activities: awake, substances: [], intakes: [meal] });

  it("stays in the stomach for hours, in line with an energy-limited rate", () => {
    const l15 = ledgerAt(tr, "p", 1015)!;
    expect(l15.stomach / foodKcalOf(meal)).toBeGreaterThan(0.9);
    const l5h = ledgerAt(tr, "p", 1000 + 300)!;
    expect(l5h.stomach).toBeLessThan(250);
    const l8h = ledgerAt(tr, "p", 1000 + 480)!;
    expect(l8h.stomach).toBeLessThan(5);
  });

  it("peaks triglycerides later than glucose", () => {
    const g = peakOf(tr.series.glucose, 1000, 1400);
    const f = peakOf(tr.series.tg, 1000, 1600);
    expect(f.at - 1000).toBeGreaterThan(150);
    expect(f.at - 1000).toBeLessThan(420);
    expect(f.at).toBeGreaterThan(g.at);
  });

  it("conserves energy across every store", () => {
    for (const t of [1010, 1100, 1300, 1700]) {
      const l = ledgerAt(tr, "p", t)!;
      const total = LEDGER_KEYS.reduce((s, k) => s + l[k], 0);
      const kcal = foodKcalOf(meal);
      // Fiber adds to the colon column without being counted as digestible energy.
      expect(total).toBeGreaterThan(kcal * 0.97);
      expect(total).toBeLessThan(kcal * 1.03);
    }
  });

  it("pulls blood toward the gut while digesting", () => {
    expect(value(tr, "flowGut", 1060)).toBeGreaterThan(value(tr, "flowGut", 900) + 0.04);
  });
});
