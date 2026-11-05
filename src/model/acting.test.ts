import { describe, expect, it } from "vitest";
import { actingAt } from "./acting";
import { CustomSubstance, Intake, Scenario, simulate } from "./simulate";

const nothing = { waterMl: 0, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 0, alcoholG: 0 };
const lunch: Intake = { ...nothing, id: "lunch", label: "Lunch", at: 13 * 60, grams: 400, waterMl: 200, carbsG: 90, sugarG: 15, fatG: 25, proteinG: 30, fiberG: 6 };
const coffee: Intake = { ...nothing, id: "coffee", label: "Coffee", at: 12 * 60 + 30, grams: 240, waterMl: 240, caffeineMg: 150 };
const beer: Intake = { ...nothing, id: "beer", label: "Beer", at: 13 * 60 + 30, grams: 500, waterMl: 450, carbsG: 15, alcoholG: 20 };
const nicotine: CustomSubstance = {
  id: "nicotine",
  label: "Nicotine",
  at: 13 * 60 + 30,
  route: "inhaled",
  doseMg: 1.2,
  tmaxMin: 6,
  halfLifeH: 2,
  volumeLPerKg: 2.6,
  bioavailability: 1,
  targets: [{ organ: "brain", effect: "Releases dopamine" }],
  source: "Benowitz 2009",
};
const body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const activities = [{ from: -1440, posture: "sleeping" as const }, { from: 8 * 60, posture: "sitting" as const }];
const day = (over: Partial<Scenario> = {}): Scenario => ({ body, activities, substances: [], intakes: [], events: [], ...over });
// Processes Claude added run all day whatever happens, so these look at what today's events set off.
const titles = (over: Partial<Scenario>, minute: number, organ: Parameters<typeof actingAt>[2]) =>
  actingAt(simulate(day(over)), minute, organ)
    .map((acting) => acting.process.id)
    .filter((id) => !id.startsWith("ext:"));

describe("what is acting on an organ", () => {
  it("is nothing on a quiet day", () => {
    expect(titles({}, 12 * 60, "liver")).toEqual([]);
  });

  it("names everything at the liver at once: the food, the caffeine, the alcohol, and a substance Claude defined", () => {
    const liver = titles({ intakes: [lunch, coffee, beer], substances: [nicotine] }, 14 * 60, "liver");
    expect(liver.some((id) => id.startsWith("meal:") || id.startsWith("intake:"))).toBe(true);
    expect(liver.some((id) => id.includes("caffeine") || id.includes("coffee"))).toBe(true);
    expect(liver.some((id) => id.includes("alcohol"))).toBe(true);
    expect(liver).toContain("substance:nicotine");
  });

  it("reaches an organ Claude named as a target, with what Claude said it does there", () => {
    const [acting] = actingAt(simulate(day({ substances: [nicotine] })), 13 * 60 + 40, "brain");
    expect(acting.process.id).toBe("substance:nicotine");
    expect(acting.say).toBe("Releases dopamine.");
  });

  it("sends something inhaled through the lungs and skips the gut", () => {
    const tr = simulate(day({ substances: [nicotine] }));
    expect(titles({ substances: [nicotine] }, 13 * 60 + 32, "lungs")).toEqual(["substance:nicotine"]);
    expect(titles({ substances: [nicotine] }, 13 * 60 + 32, "small_intestine")).toEqual([]);
    expect(actingAt(tr, 13 * 60 + 40, "brain")[0].from).toBe("heart");
  });

  it("says something inhaled starts in the lungs, even when it also acts on them", () => {
    const tr = simulate(day({ substances: [{ ...nicotine, targets: [{ organ: "lungs", effect: "Irritates the lining" }] }] }));
    expect(actingAt(tr, 13 * 60 + 33, "lungs").find((acting) => acting.process.id === "substance:nicotine")?.from).toBeNull();
  });

  it("leaves out what always runs", () => {
    expect(titles({ intakes: [lunch] }, 14 * 60, "heart")).not.toContain("circulation");
  });

  it("is gone once the thing is over", () => {
    expect(titles({ substances: [nicotine] }, 28 * 60, "brain")).toEqual([]);
  });
});
