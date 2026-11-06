import { describe, expect, it } from "vitest";
import { simulate } from "./engine/simulate";
import { GUT } from "./params";
import { foodKcalOf, type Intake, type Scenario } from "./scenario";
import { hm, NO_NUTRIENTS } from "./testKit";
import { arrivingFoods, foodsInStomach, whereabouts } from "./whereabouts";

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
const smallJuice = food("small juice", hm(12), { grams: 100, waterMl: 90, carbsG: 10, sugarG: 10, liquid: true });
const bigJuice = food("big juice", hm(12), { grams: 300, waterMl: 270, carbsG: 30, sugarG: 30, liquid: true });
const coffee = food("coffee", hm(9), { grams: 250, waterMl: 250, caffeineMg: 95, liquid: true });

describe("where a food is", () => {
  it("starts out wholly in the stomach and adds up to what you ate, with fibre's energy on top", () => {
    const day = simulate({ ...quiet, intakes: [pizza] });
    const [first] = whereabouts(day, pizza.at);
    expect(first.places[0].key).toBe("stomach");
    for (const t of [hm(12, 30), hm(14), hm(18), hm(23)]) {
      const [where] = whereabouts(day, t);
      expect(where.unit).toBe("kcal");
      const shares = where.places.reduce((sum, place) => sum + place.share, 0);
      expect(shares).toBeGreaterThan(0.97);
      expect(shares).toBeLessThan(1 + (pizza.fiberG * GUT.fiberKcalPerG) / foodKcalOf(pizza) + 0.001);
      expect(where.places.map((place) => place.amount)).toEqual(
        where.places.map((place) => place.amount).sort((a, b) => b - a),
      );
    }
  });

  it("knows nothing about a food you haven't had yet", () => {
    const day = simulate({ ...quiet, intakes: [pizza] });
    expect(whereabouts(day, hm(11))).toEqual([]);
  });

  it("follows coffee in milligrams, as far as the liver clearing it", () => {
    const day = simulate({ ...quiet, intakes: [coffee] });
    const [where] = whereabouts(day, hm(20));
    expect(where.unit).toBe("mg");
    expect(where.total).toBe(95);
    expect(where.places.map((place) => place.key)).toContain("cleared");
  });

  it("drops yesterday's food once it has arrived, and keeps a late one still on its way", () => {
    const lateLastNight = { ...pizza, id: "late", at: -30 };
    const day = simulate({
      ...quiet,
      activities: [
        { from: -1440, posture: "sitting" },
        { from: 0, posture: "sleeping" },
        { from: hm(7), posture: "sitting" },
      ],
      intakes: [lateLastNight],
    });
    expect(whereabouts(day, 0).map((where) => where.id)).toEqual(["late"]);
    expect(whereabouts(day, hm(20))).toEqual([]);
  });
});

describe("which foods are behind a rate", () => {
  it("names the foods carbs are arriving from, biggest first", () => {
    const day = simulate({ ...quiet, intakes: [smallJuice, bigJuice] });
    expect(arrivingFoods(day, hm(12, 20), "carbs")).toEqual(["big juice", "small juice"]);
  });

  it("says nothing when nothing is arriving", () => {
    expect(arrivingFoods(simulate(quiet), hm(12), "carbs")).toEqual([]);
    expect(arrivingFoods(simulate(quiet), hm(12), "fat")).toEqual([]);
  });

  it("names only what is still held in the stomach", () => {
    const day = simulate({ ...quiet, intakes: [pizza] });
    expect(foodsInStomach(day, hm(12, 30))).toEqual(["pizza"]);
    expect(foodsInStomach(day, hm(23))).toEqual([]);
  });
});
