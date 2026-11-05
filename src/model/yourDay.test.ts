import { describe, expect, it } from "vitest";
import { Intake, Scenario, simulate } from "./simulate";
import { processIdsOf } from "./yourDay";

const nothing = { waterMl: 0, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 0, alcoholG: 0 };
const lunch: Intake = { ...nothing, id: "lunch", label: "Lunch", at: 13 * 60, grams: 400, waterMl: 200, carbsG: 90, sugarG: 15, fatG: 25, proteinG: 30, fiberG: 6 };
const beer: Intake = { ...nothing, id: "beer", label: "Beer", at: 16 * 60, grams: 500, waterMl: 450, carbsG: 15, alcoholG: 20 };
const body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const activities = [{ from: -1440, posture: "sleeping" as const }, { from: 8 * 60, posture: "sitting" as const }];
const day: Scenario = { body, activities, substances: [], intakes: [lunch], events: [] };
const minute = 17 * 60;

describe("telling what a question added from what was already your day", () => {
  const yours = processIdsOf(simulate(day), minute);

  it("counts what you ate as your day", () => {
    expect([...yours].some((id) => id.includes("lunch"))).toBe(true);
  });

  it("leaves only the beer once the question adds one", () => {
    const added = [...processIdsOf(simulate({ ...day, intakes: [lunch, beer] }), minute)].filter((id) => !yours.has(id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((id) => id.includes("beer"))).toBe(true);
  });

  it("finds nothing new when a question adds nothing", () => {
    expect([...processIdsOf(simulate(day), minute)].filter((id) => !yours.has(id))).toEqual([]);
  });
});
