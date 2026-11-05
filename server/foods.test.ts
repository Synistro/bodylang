import { describe, expect, it } from "vitest";
import { combineIngredients, foodById, foodLine, nutrientsOf, searchFoods, sourceOf } from "./foods";

const first = (query: string) => searchFoods(query)[0]?.name ?? "";

describe("the food table", () => {
  it("finds what people actually say", () => {
    expect(first("beer")).toMatch(/^Beer/);
    expect(first("coffee brewed")).toMatch(/^Coffee, brewed/);
    expect(first("apple raw")).toMatch(/^Apple/);
    expect(searchFoods("pizza cheese thin crust").some((food) => /^Pizza, cheese.*thin crust/.test(food.name))).toBe(true);
    expect(first("espresso")).toMatch(/espresso/i);
    expect(first("banana")).toMatch(/^Banana/);
    expect(first("white rice cooked")).toMatch(/rice/i);
    expect(first("bananas")).toMatch(/^Banana/);
  });

  it("gives nothing for a word no food has", () => {
    expect(searchFoods("zzqx")).toEqual([]);
  });

  it("scales everything with the grams", () => {
    const food = searchFoods("apple raw")[0];
    const one = nutrientsOf(food, 100);
    const two = nutrientsOf(food, 200);
    expect(one.carbsG).toBeCloseTo(food.per100g.carbs);
    expect(two.fatG).toBeCloseTo(one.fatG * 2);
    expect(two.grams).toBe(200);
  });

  it("carries caffeine and alcohol from the table", () => {
    const coffee = searchFoods("coffee brewed")[0];
    expect(nutrientsOf(coffee, 240).caffeineMg).toBeGreaterThan(80);
    const beer = searchFoods("beer")[0];
    expect(nutrientsOf(beer, 355).alcoholG).toBeGreaterThan(8);
  });

  it("adds up a dish from its ingredients", () => {
    const cheese = searchFoods("cottage cheese")[0];
    const flour = searchFoods("wheat flour white")[0];
    const { nutrients, source } = combineIngredients([{ food: cheese, grams: 120 }, { food: flour, grams: 30 }]);
    expect(nutrients.grams).toBe(150);
    expect(nutrients.carbsG).toBeCloseTo(nutrientsOf(cheese, 120).carbsG + nutrientsOf(flour, 30).carbsG);
    expect(source).toMatchObject({ kind: "recipe", ingredients: [{ fdcId: cheese.fdcId, grams: 120 }, { fdcId: flour.fdcId, grams: 30 }] });
  });

  it("describes a food in one line with its id", () => {
    const food = searchFoods("apple raw")[0];
    expect(foodById(food.fdcId)?.name).toBe(food.name);
    expect(foodLine(food)).toContain(String(food.fdcId));
    expect(sourceOf(food)).toEqual({ kind: "table", fdcId: food.fdcId, name: food.name, dataset: food.dataset });
  });
});
