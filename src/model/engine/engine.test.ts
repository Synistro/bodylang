import { describe, expect, it } from "vitest";
import { GUT, HEART } from "../params";
import { processesAt } from "../processes/processes";
import { foodKcalOf, POSTURES } from "../scenario";
import { hm, NO_NUTRIENTS } from "../testKit";
import { SCENARIOS } from "../testScenarios";
import { maxHeartRate } from "../events/muscles";
import { heartFromCaffeine, heartFromDigestion } from "./heart";
import { simulate } from "./simulate";
import { LEDGER_KEYS, ledgerAt, SERIES, value } from "./trajectory";

const EVERY_DAY = Object.entries(SCENARIOS).map(([name, scenario]) => [name, simulate(scenario)] as const);
const SAMPLES = Array.from({ length: 60 }, (_, i) => i * 30);

describe.each(EVERY_DAY)("%s", (_name, tr) => {
  it("explains its heart rate by the parts the engine added up", () => {
    const { restingBpm } = tr.anthro;
    const most = maxHeartRate(tr.scenario.body.age);
    for (const t of SAMPLES) {
      const posture = POSTURES[Math.round(tr.series.posture[t])];
      const parts =
        restingBpm +
        HEART.byActivity[posture] +
        heartFromDigestion(tr.series.digestion[t]) +
        heartFromCaffeine(tr.series.caffeine[t]) +
        tr.channels.heartRate[t];
      expect(value(tr, "hr", t)).toBeCloseTo(Math.min(most, parts), 2);
    }
  });

  it("loses no food: all of it stays somewhere", () => {
    for (const intake of tr.scenario.intakes) {
      const eaten = foodKcalOf(intake);
      const fiberKcal = intake.fiberG * GUT.fiberKcalPerG;
      for (const t of SAMPLES) {
        if (t <= intake.at) continue;
        const ledger = ledgerAt(tr, intake.id, t);
        if (!ledger) throw new Error(intake.id);
        const total = LEDGER_KEYS.reduce((sum, key) => sum + ledger[key], 0);
        expect(total).toBeGreaterThanOrEqual(eaten * 0.98);
        expect(total).toBeLessThanOrEqual((eaten + fiberKcal) * 1.02 + 1);
      }
    }
  });
});

describe("who gets the credit for sugar leaving the blood", () => {
  const body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
  const activities = [
    { from: 0, posture: "sleeping" },
    { from: hm(7), posture: "sitting" },
  ] as const;
  const workout = {
    id: "gym",
    label: "Gym",
    preset: "training",
    from: hm(10),
    until: hm(11),
    intensity: 0.8,
    muscles: [{ group: "quads", load: 1 }],
    symptoms: [],
    custom: null,
    source: "",
  } as const;
  const line = (day: Parameters<typeof simulate>[0], t: number) =>
    processesAt(simulate(day), t).find((process) => process.id === "insulin");

  it("gives a fasted workout to working muscle, with insulin at rest", () => {
    const process = line(
      {
        body,
        activities: [...activities],
        intakes: [],
        substances: [],
        events: [{ ...workout, muscles: [...workout.muscles], symptoms: [] }],
      },
      hm(10, 40),
    );
    expect(process?.active).toBe(false);
    expect(process?.headline).toMatch(/at rest/);
    expect(process?.stops.find((stop) => stop.id === "muscle")?.say).toMatch(/Moving muscles/);
  });

  it("gives a meal at rest to insulin", () => {
    const rice = {
      ...NO_NUTRIENTS,
      id: "rice",
      label: "Rice",
      at: hm(12),
      grams: 250,
      waterMl: 170,
      carbsG: 70,
      proteinG: 7,
    };
    const process = line({ body, activities: [...activities], intakes: [rice], substances: [], events: [] }, hm(13));
    expect(process?.active).toBe(true);
    expect(process?.stops.find((stop) => stop.id === "muscle")?.say).toMatch(/Insulin opens/);
  });
});

describe("the curves", () => {
  it("are all written by the loop, because a name in SERIES with no line in recordSeries stays at zero", () => {
    const moved = (name: (typeof SERIES)[number]) => EVERY_DAY.some(([, tr]) => tr.series[name].some((v) => v !== 0));
    expect(SERIES.filter((name) => !moved(name))).toEqual([]);
  });
});
