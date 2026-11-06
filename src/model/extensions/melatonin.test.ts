import { describe, expect, it } from "vitest";
import { viewOf } from "../processes/processes";
import { simulate } from "../engine/simulate";
import { type Scenario } from "../scenario";
import { levelWord } from "./api";
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

  it("reads the true clock at every minute of the day", () => {
    const view = viewOf(simulate(base));
    const clock = (minute: number) => extension.at(view, minute).stops.find((s) => s.id === "clock")?.reading;
    const expected = (minute: number) =>
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const wrong = Array.from({ length: 1440 }, (_, minute) => minute).filter((m) => clock(m) !== expected(m));
    expect(wrong).toEqual([]);
  });

  it("reads sleepiness in the app's word for a scale", () => {
    const view = viewOf(simulate(base));
    const sleep = extension.at(view, 15 * 60).stops.find((s) => s.id === "sleep");
    expect(sleep?.reading).toBe(levelWord(view.value("drowsy", 15 * 60)));
  });

  it("says melatonin stays low during a daytime nap", () => {
    const nap: Scenario = {
      ...base,
      activities: [...day, { from: 840, posture: "sleeping" }, { from: 900, posture: "standing" }],
    };
    const state = extension.at(viewOf(simulate(nap)), 870);
    const sleep = state.stops.find((s) => s.id === "sleep");
    expect(state.active).toBe(false);
    expect(sleep?.reading).toBe("Asleep");
    expect(sleep?.say).toMatch(/melatonin stays low/);
  });
});
