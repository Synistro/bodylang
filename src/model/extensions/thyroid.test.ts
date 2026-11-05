import { describe, expect, it } from "vitest";
import { viewOf } from "../processes";
import { simulate, type Scenario } from "../simulate";
import { checkExtension } from "./check";
import { extension } from "./thyroid";

const body = { sex: "male" as const, age: 30, heightCm: 180, weightKg: 80 };
const day = [{ from: 0, posture: "sleeping" as const }, { from: 450, posture: "standing" as const }];
const base: Scenario = { body, intakes: [], activities: day, substances: [], events: [] };

const num = (s: string) => parseFloat(s.replace(/[^0-9.]/g, ""));
const reading = (scenario: Scenario, minute: number, stop: string) => {
  const state = extension.at(viewOf(simulate(scenario)), minute);
  const found = state.stops.find((s) => s.id === stop);
  if (!found) throw new Error(`no stop ${stop}`);
  return num(found.reading);
};

describe("thyroid", () => {
  it("keeps to the contract", () => {
    expect(checkExtension(extension, "thyroid")).toEqual([]);
  });

  it("puts the TSH peak in the night and the low in the afternoon (Brabant 1990)", () => {
    expect(reading(base, 150, "pituitary")).toBeGreaterThan(reading(base, 900, "pituitary"));
  });

  it("lets TSH climb higher when awake through the night than when asleep", () => {
    const awake: Scenario = { ...base, activities: [{ from: 0, posture: "sitting" }, { from: 450, posture: "standing" }] };
    expect(reading(awake, 120, "pituitary")).toBeGreaterThan(reading(base, 120, "pituitary"));
  });

  it("lowers T3 during a logged illness, while T4 barely moves", () => {
    const cold = { id: "cold", label: "Cold", preset: "illness" as const, from: 300, until: null, intensity: 0.8, muscles: [], symptoms: ["fever" as const], custom: null, source: "" };
    const sick: Scenario = { ...base, events: [cold] };
    const view = viewOf(simulate(sick));
    expect(view.value("inflammation", 900)).toBeGreaterThan(0);
    const t3Sick = reading(sick, 900, "liver");
    const t3Well = reading(base, 900, "liver");
    expect(t3Sick).toBeLessThan(t3Well);
    const t4Change = Math.abs(reading(sick, 900, "thyroid") - reading(base, 900, "thyroid")) / reading(base, 900, "thyroid");
    expect(t4Change).toBeLessThan((t3Well - t3Sick) / t3Well);
    expect(extension.at(view, 900).here).toBe("liver");
  });

  it("shows the model's own heart rate, which rises with a run", () => {
    const run: Scenario = { ...base, activities: [...day, { from: 600, posture: "running" }, { from: 660, posture: "sitting" }] };
    expect(reading(run, 630, "heart")).toBeGreaterThan(reading(base, 630, "heart"));
  });
});
