import { describe, expect, it } from "vitest";
import { viewOf } from "../processes/processes";
import { simulate } from "../engine/simulate";
import { type Scenario } from "../scenario";
import { checkExtension } from "./check";
import { extension } from "./melatonin";

const body = { sex: "male" as const, age: 30, heightCm: 180, weightKg: 80 };
const day = [
  { from: 0, posture: "sleeping" as const },
  { from: 450, posture: "standing" as const },
];
const base: Scenario = { body, intakes: [], activities: day, substances: [], events: [] };

const pgOf = (scenario: Scenario, minute: number) => {
  const state = extension.at(viewOf(simulate(scenario)), minute);
  const blood = state.stops.find((s) => s.id === "blood");
  if (!blood) throw new Error("no blood stop");
  return parseFloat(blood.reading);
};

describe("melatonin", () => {
  it("keeps to the contract", () => {
    expect(checkExtension(extension, "melatonin")).toEqual([]);
  });

  it("is high in the middle of the night and near zero at midday (Arendt 1998)", () => {
    const night = pgOf(base, 3 * 60);
    const noon = pgOf(base, 12 * 60);
    expect(night).toBeGreaterThan(40);
    expect(noon).toBeLessThan(10);
    expect(extension.at(viewOf(simulate(base)), 12 * 60).active).toBe(false);
  });

  it("starts rising in the evening before the usual bedtime (dim light melatonin onset)", () => {
    expect(pgOf(base, 22 * 60)).toBeGreaterThan(pgOf(base, 19 * 60) + 5);
  });

  it("has fallen by mid-morning after waking", () => {
    expect(pgOf(base, 9 * 60)).toBeLessThan(pgOf(base, 4 * 60) / 4);
  });

  it("is held lower when awake through the night, as in room light (Gooley 2011)", () => {
    const upAllNight: Scenario = {
      ...base,
      activities: [
        { from: 0, posture: "sitting" },
        { from: 450, posture: "standing" },
      ],
    };
    const view = viewOf(simulate(upAllNight));
    expect(view.value("posture", 120)).toBeGreaterThan(0.5);
    expect(pgOf(upAllNight, 120)).toBeLessThan(pgOf(base, 120));
    expect(extension.at(view, 120).here).toBe("clock");
  });
});
