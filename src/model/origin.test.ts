import { describe, expect, it } from "vitest";
import { assess } from "./assess/assess";
import { foodOrigin, processOrigin, readingOrigin } from "./origin";
import { processesAt } from "./processes/processes";
import { simulate } from "./engine/simulate";
import { Intake } from "./scenario";
import type { BodyEvent } from "./events";

const body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const wake = [{ from: 0, posture: "sleeping" }, { from: 450, posture: "standing" }] as const;
const meal = (over: Partial<Intake> = {}): Intake => ({ id: "pizza", label: "Pizza", at: 780, grams: 200, waterMl: 90, carbsG: 60, sugarG: 6, fatG: 20, proteinG: 20, fiberG: 4, caffeineMg: 0, alcoholG: 0, ...over });
const TABLE = { kind: "table", fdcId: 1, name: "Pizza, cheese", dataset: "FNDDS" } as const;
const sauna: BodyEvent = { id: "sauna", label: "Sauna", preset: "custom", from: 800, until: 830, intensity: 1, muscles: [], symptoms: [], source: "My estimate", custom: { systems: ["circulation"], effects: [{ channel: "heartRate", amount: 40, riseMin: 5, halfLifeMin: 20 }], feelings: [], stops: [{ organ: "heart", muscle: null, label: "Heart", afterMin: 0, say: "Beating faster.", routes: [] }] } };

const run = (intakes: Intake[], events: BodyEvent[] = []) => simulate({ body, intakes, activities: [...wake], substances: [], events });
const reading = (tr: ReturnType<typeof run>, id: string, t: number) => {
  const found = assess(tr, t).readings.find((r) => r.id === id);
  if (!found) throw new Error(id);
  return readingOrigin(found, tr, t);
};

describe("where a reading comes from", () => {
  it("is the model alone when nothing of Claude's is involved", () => {
    const tr = run([]);
    expect(reading(tr, "glucose", 700).kind).toBe("model");
    expect(reading(tr, "glucose", 700).detail).toMatch(/evidence A/);
    expect(reading(tr, "glucose", 700).detail).toMatch(/ADA/);
  });

  it("names a food whose contents Claude estimated, while it is at work", () => {
    const tr = run([meal({ source: { kind: "estimate" } })]);
    const during = reading(tr, "glucose", 820);
    expect(during.kind).toBe("claude-input");
    expect(during.detail).toMatch(/Pizza: Claude's estimate/);
    expect(reading(tr, "glucose", 1700).kind).toBe("model");
  });

  it("stays the model's for a table food, and says the portion is an estimate", () => {
    const during = reading(run([meal({ source: TABLE })]), "glucose", 820);
    expect(during.kind).toBe("model");
    expect(during.detail).toMatch(/Portions are Claude's estimates/);
  });

  it("leaves a reading food can't touch alone", () => {
    expect(reading(run([meal({ source: { kind: "estimate" } })]), "temperature", 820).kind).toBe("model");
  });

  it("marks only what a custom event pushes, only while it pushes", () => {
    const tr = run([], [sauna]);
    expect(reading(tr, "hr", 815).kind).toBe("claude-input");
    expect(reading(tr, "hr", 815).detail).toMatch(/Sauna/);
    expect(reading(tr, "temperature", 815).kind).toBe("model");
    expect(reading(tr, "hr", 700).kind).toBe("model");
  });
});

describe("where a food comes from", () => {
  it("credits the table and says who decided the portion", () => {
    const origin = foodOrigin(meal({ source: TABLE }));
    expect(origin.kind).toBe("usda");
    expect(origin.detail).toMatch(/Pizza, cheese/);
    expect(origin.detail).toMatch(/Claude estimated the portion/);
    expect(foodOrigin(meal({ source: TABLE, portionBy: "you" })).detail).toMatch(/You corrected the portion/);
  });

  it("counts an unsourced food as Claude's, because nothing else vouches for it", () => {
    expect(foodOrigin(meal()).kind).toBe("claude-input");
    expect(foodOrigin(meal({ source: { kind: "estimate" } })).kind).toBe("claude-input");
    const recipe = foodOrigin(meal({ source: { kind: "recipe", ingredients: [{ fdcId: 1, name: "Flour", grams: 30 }] } }));
    expect(recipe.kind).toBe("claude-input");
    expect(recipe.detail).toContain("30 g Flour");
  });
});

describe("where a meal comes from", () => {
  const rice = (source: Intake["source"]) => ({ ...meal({ source }), id: "rice", label: "Rice" });
  const sauce = (source: Intake["source"]) => ({ ...meal({ source }), id: "sauce", label: "Sauce", at: 782 });
  const origin = (...foods: Intake[]) => {
    const tr = run(foods);
    const line = processesAt(tr, 800).find((p) => p.id === "meal:rice");
    if (!line) throw new Error("no meal line");
    return processOrigin(tr, line);
  };

  it("reports its weakest source, wherever that food comes in the meal", () => {
    expect(origin(rice(TABLE), sauce({ kind: "estimate" })).kind).toBe("claude-input");
    expect(origin(rice({ kind: "estimate" }), sauce(TABLE)).kind).toBe("claude-input");
    expect(origin(rice(TABLE), sauce({ kind: "estimate" })).detail).toMatch(/Sauce/);
  });

  it("is the table when all of it is", () => {
    expect(origin(rice(TABLE), sauce(TABLE)).kind).toBe("usda");
  });
});

describe("where a line through the body comes from", () => {
  const line = (tr: ReturnType<typeof run>, id: string, t: number) => {
    const process = processesAt(tr, t).find((p) => p.id === id);
    if (!process) throw new Error(`${id}: ${processesAt(tr, t).map((p) => p.id).join(", ")}`);
    return processOrigin(tr, process);
  };

  it("cites the model's source for its own lines", () => {
    expect(line(run([]), "insulin", 700)).toMatchObject({ kind: "model" });
    expect(line(run([]), "insulin", 700).detail).toMatch(/Bergman|minimal/i);
  });

  it("says a custom event's numbers and words are Claude's", () => {
    const origin = line(run([], [sauna]), "event:sauna", 815);
    expect(origin.kind).toBe("claude-input");
    expect(origin.detail).toMatch(/My estimate/);
  });

  it("follows the food a line is about", () => {
    expect(line(run([meal({ source: TABLE })]), "intake:pizza", 820).kind).toBe("usda");
    expect(line(run([meal({ source: { kind: "estimate" } })]), "intake:pizza", 820).kind).toBe("claude-input");
  });
});
