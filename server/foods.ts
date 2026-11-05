import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { FoodSource, Nutrients } from "../src/model/simulate";

const RESULTS_PER_QUERY = 6;
const PORTIONS_SHOWN = 4;
const MATCH = { whole: 3, start: 1.5, firstWord: 2, missing: -3, perExtraWord: -0.15, asEaten: 0.5 };
const LEAST_PREFIX = 4;

export interface Food {
  fdcId: number;
  name: string;
  dataset: string;
  per100g: { water: number; carbs: number; sugar: number; fat: number; protein: number; fiber: number; caffeine: number; alcohol: number };
  portions: { label: string; grams: number }[];
}

const rowSchema = z.tuple([z.number(), z.string(), z.string(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.array(z.tuple([z.string(), z.number()]))]);

// "Tomatoes," and "tomato" are the same word to someone looking for one.
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
      if (word.length > 4 && word.endsWith("oes")) return word.slice(0, -2);
      if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
      return word;
    });
}

interface Indexed {
  food: Food;
  all: Set<string>;
  first: Set<string>;
  count: number;
}

let table: Indexed[] | null = null;

function foods(): Indexed[] {
  if (table) return table;
  const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), "server/foods.json"), "utf8"));
  table = z
    .array(rowSchema)
    .parse(raw)
    .map(([fdcId, name, dataset, water, carbs, sugar, fat, protein, fiber, caffeine, alcohol, portions]) => {
      const all = words(name);
      return {
        food: { fdcId, name, dataset, per100g: { water, carbs, sugar, fat, protein, fiber, caffeine, alcohol }, portions: portions.map(([label, grams]) => ({ label, grams })) },
        all: new Set(all),
        first: new Set(all.slice(0, 1)),
        count: all.length,
      };
    });
  return table;
}

function scoreOf(row: Indexed, query: string[]): number {
  let score = 0;
  let matched = 0;
  for (const word of query) {
    if (row.all.has(word)) {
      score += MATCH.whole + (row.first.has(word) ? MATCH.firstWord : 0);
      matched++;
    } else if (word.length >= LEAST_PREFIX && [...row.all].some((own) => own.startsWith(word))) {
      score += MATCH.start;
      matched++;
    } else {
      score += MATCH.missing;
    }
  }
  if (!matched) return -Infinity;
  return score + MATCH.perExtraWord * Math.max(0, row.count - query.length) + (row.food.dataset === "FNDDS" ? MATCH.asEaten : 0);
}

export function searchFoods(query: string, limit = RESULTS_PER_QUERY): Food[] {
  const wanted = words(query);
  return foods()
    .map((row) => ({ food: row.food, score: scoreOf(row, wanted) }))
    .filter((row) => row.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.food);
}

export const foodById = (fdcId: number): Food | undefined => foods().find((row) => row.food.fdcId === fdcId)?.food;

export function nutrientsOf(food: Food, grams: number): Nutrients {
  const per = grams / 100;
  const { water, carbs, sugar, fat, protein, fiber, caffeine, alcohol } = food.per100g;
  return { grams, waterMl: water * per, carbsG: carbs * per, sugarG: sugar * per, fatG: fat * per, proteinG: protein * per, fiberG: fiber * per, caffeineMg: caffeine * per, alcoholG: alcohol * per };
}

// A dish is the sum of what went into it.
export function combineIngredients(parts: { food: Food; grams: number }[]): { nutrients: Nutrients; source: FoodSource } {
  const each = parts.map(({ food, grams }) => nutrientsOf(food, grams));
  const total = (key: keyof Nutrients) => each.reduce((sum, n) => sum + n[key], 0);
  return {
    nutrients: { grams: total("grams"), waterMl: total("waterMl"), carbsG: total("carbsG"), sugarG: total("sugarG"), fatG: total("fatG"), proteinG: total("proteinG"), fiberG: total("fiberG"), caffeineMg: total("caffeineMg"), alcoholG: total("alcoholG") },
    source: { kind: "recipe", ingredients: parts.map(({ food, grams }) => ({ fdcId: food.fdcId, name: food.name, grams })) },
  };
}

export const sourceOf = (food: Food): FoodSource => ({ kind: "table", fdcId: food.fdcId, name: food.name, dataset: food.dataset });

// One line per food: the id to log it with, what it is, what 100 g holds, and the portions the table knows.
export function foodLine(food: Food): string {
  const p = food.per100g;
  const extras = [p.caffeine > 0 ? `caffeine ${p.caffeine} mg` : "", p.alcohol > 0 ? `alcohol ${p.alcohol} g` : ""].filter(Boolean).join(", ");
  const portions = food.portions.slice(0, PORTIONS_SHOWN).map((portion) => `${portion.label} = ${portion.grams} g`).join("; ");
  return `${food.fdcId} | ${food.name} | per 100 g: carbs ${p.carbs} g (sugar ${p.sugar}, fiber ${p.fiber}), fat ${p.fat} g, protein ${p.protein} g, water ${p.water} g${extras ? `, ${extras}` : ""} | ${portions || "no portions listed"}`;
}
