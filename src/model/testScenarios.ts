import type { BodyEvent } from "./events/types";
import type { ActivitySpan, Body, CustomSubstance, Intake, Scenario } from "./scenario";
import { hm, NO_NUTRIENTS } from "./testKit";

const man: Body = { sex: "male", age: 30, heightCm: 180, weightKg: 80 };
export const woman: Body = { sex: "female", age: 62, heightCm: 163, weightKg: 92 };
const wake: ActivitySpan[] = [{ from: 0, posture: "sleeping" }, { from: hm(7, 30), posture: "sitting" }];
const blank = { muscles: [], symptoms: [], custom: null, source: "" };

export const food = (id: string, label: string, at: number, parts: Partial<Intake>): Intake => ({ ...NO_NUTRIENTS, id, label, at, ...parts });
export const coffee = food("coffee", "Coffee", hm(8, 30), { grams: 250, waterMl: 250, caffeineMg: 95, liquid: true });
const sugarBar = food("sugar_bar", "Sugar bar", hm(16, 40), { grams: 50, waterMl: 3, carbsG: 31, sugarG: 27, fatG: 12, proteinG: 4, fiberG: 1 });
export const pizza = food("pizza", "Pizza", hm(16, 45), { grams: 240, waterMl: 110, carbsG: 72, sugarG: 8, fatG: 26, proteinG: 28, fiberG: 4 });
const breakfast = food("breakfast", "Breakfast", hm(8), { grams: 300, waterMl: 150, carbsG: 60, sugarG: 15, fatG: 10, proteinG: 15, fiberG: 5 });
const lunch = food("lunch", "Lunch", hm(13), { grams: 500, waterMl: 300, carbsG: 75, sugarG: 10, fatG: 20, proteinG: 30, fiberG: 7 });
const dinner = food("dinner", "Dinner", hm(19), { grams: 550, waterMl: 350, carbsG: 80, sugarG: 10, fatG: 25, proteinG: 35, fiberG: 8 });
const apples = food("apples", "Two apples", hm(9), { grams: 364, waterMl: 310, carbsG: 50, sugarG: 38, fatG: 0.6, proteinG: 1, fiberG: 9, fructoseShare: 0.6 });
const banana = food("banana", "Banana", hm(9), { grams: 120, waterMl: 90, carbsG: 27, sugarG: 14, fatG: 0.4, proteinG: 1.3, fiberG: 3 });
const rice = food("rice", "White rice", hm(12), { grams: 250, waterMl: 170, carbsG: 70, fatG: 0.7, proteinG: 7, fiberG: 1 });
const glucoseDrink = food("glucose", "Glucose drink", hm(9), { grams: 300, waterMl: 225, carbsG: 75, liquid: true });
const cola = food("cola", "Cola", hm(15), { grams: 330, waterMl: 295, carbsG: 35, sugarG: 35, caffeineMg: 32, liquid: true });
const fatTest = food("fat_test", "Fat test", hm(12), { grams: 300, waterMl: 150, carbsG: 25, sugarG: 15, fatG: 75, proteinG: 10 });
const burger = food("burger", "Burger and fries", hm(12), { grams: 550, waterMl: 280, carbsG: 95, sugarG: 15, fatG: 60, proteinG: 40, fiberG: 6 });
const water = food("water", "Water", hm(9), { grams: 500, waterMl: 500, liquid: true });
const beer = food("beer", "Beer", hm(19), { grams: 500, waterMl: 460, carbsG: 18, sugarG: 1, alcoholG: 20, liquid: true });
const vodka = food("vodka", "Vodka", hm(20), { grams: 60, waterMl: 40, alcoholG: 20, liquid: true });
const latte = food("latte", "Latte", hm(9), { grams: 350, waterMl: 320, carbsG: 14, sugarG: 14, fatG: 9, proteinG: 9, caffeineMg: 80, liquid: true });
const ibuprofen: CustomSubstance = { id: "ibuprofen", label: "Ibuprofen", at: hm(13), doseMg: 400, tmaxMin: 90, halfLifeH: 2, volumeLPerKg: 0.15, bioavailability: 0.9, targets: [{ organ: "brain", effect: "Blocks the signal that makes pain." }], source: "Label" };

const chest: BodyEvent = { ...blank, id: "chest", label: "Chest and triceps workout", preset: "training", from: hm(8), until: hm(9), intensity: 0.8, muscles: [{ group: "chest", load: 1 }, { group: "triceps", load: 0.7 }] };
const legsYesterday: BodyEvent = { ...blank, id: "legs", label: "Leg day", preset: "training", from: hm(18) - 1440, until: hm(19) - 1440, intensity: 0.9, muscles: [{ group: "quads", load: 1 }, { group: "hamstrings", load: 0.8 }] };
const cold: BodyEvent = { ...blank, id: "cold", label: "Cold", preset: "illness", from: hm(8), until: null, intensity: 0.4, symptoms: ["cough", "congestion"] };
const fever: BodyEvent = { ...blank, id: "flu", label: "Flu", preset: "illness", from: -hm(24), until: null, intensity: 0.7, symptoms: ["cough", "fever", "fatigue"] };
const sex: BodyEvent = { ...blank, id: "sex", label: "Sex", preset: "sex", from: hm(21), until: null, intensity: 0.6 };
const exam: BodyEvent = { ...blank, id: "exam", label: "Exam", preset: "stress", from: hm(14), until: hm(16), intensity: 0.8 };
const stress: BodyEvent = { ...blank, id: "stress", label: "Stress", preset: "stress", from: hm(14), until: null, intensity: 0.7 };
const night: BodyEvent = { ...blank, id: "night", label: "Short night", preset: "poor_sleep", from: hm(7, 30), until: null, intensity: 1 };
const sauna: BodyEvent = {
  ...blank,
  id: "sauna",
  label: "Sauna",
  preset: "custom",
  from: hm(18),
  until: hm(18, 20),
  intensity: 1,
  source: "Claude's estimate",
  custom: {
    systems: ["circulation"],
    effects: [{ channel: "heartRate", amount: 40, riseMin: 10, halfLifeMin: 10 }],
    feelings: [{ id: "flushed", label: "Flushed", amount: 0.6, riseMin: 5, halfLifeMin: 20, cause: "Heat is opening your skin vessels", organ: "heart" }],
    stops: [{ organ: "heart", muscle: null, label: "Skin", afterMin: 0, say: "Blood moves to your skin to shed heat.", routes: [] }],
  },
};

export const runAt = (from: number, until: number): ActivitySpan[] => [...wake, { from, posture: "running" }, { from: until, posture: "sitting" }];
const walkAt = (from: number, until: number): ActivitySpan[] => [...wake, { from, posture: "walking" }, { from: until, posture: "sitting" }];
export const day = (intakes: Intake[], extra: Partial<Scenario> = {}): Scenario => ({ body: man, activities: wake, substances: [], intakes, events: [], ...extra });

const threeMeals = [breakfast, lunch, dinner];
// A wide set of days, which the word sweeps and the golden test both run through.
export const SCENARIOS: Record<string, Scenario> = {
  "nothing logged": day([]),
  "the opening day": day([coffee, sugarBar, pizza]),
  "three meals": day(threeMeals),
  "two apples": day([apples]),
  banana: day([banana]),
  rice: day([rice]),
  "75 g of glucose": day([glucoseDrink]),
  cola: day([cola]),
  "fat test": day([fatTest]),
  burger: day([burger]),
  "water only": day([water]),
  "pure spirit": day([vodka]),
  "a beer, pizza and a pill": day([beer, pizza], { substances: [ibuprofen] }),
  "a latte": day([latte]),
  "a run after breakfast": day([breakfast], { activities: runAt(hm(10), hm(11)) }),
  "a fasted run": day([], { activities: runAt(hm(10), hm(11)) }),
  "a walk after a meal": day([lunch], { activities: walkAt(hm(13, 30), hm(14)) }),
  "her run": { ...day([breakfast], { activities: runAt(hm(10), hm(11)) }), body: woman },
  "another body": { ...day(threeMeals), body: woman },
  "chest and triceps": day([], { events: [chest] }),
  "legs yesterday": day([], { events: [legsYesterday] }),
  "a cold": day([coffee, pizza], { events: [cold] }),
  flu: day([], { events: [fever] }),
  sex: day([], { events: [sex] }),
  "an exam": day([], { events: [exam] }),
  stress: day([], { events: [stress] }),
  "a short night": day(threeMeals, { events: [night] }),
  "a short night, slept short": day([], { activities: [{ from: 0, posture: "sitting" }, { from: hm(3), posture: "sleeping" }, { from: hm(7), posture: "sitting" }], events: [{ ...night, from: hm(7) }] }),
  sauna: day([], { events: [sauna] }),
  "everything at once": day([coffee, pizza], { activities: walkAt(hm(19), hm(19, 30)), events: [chest, fever, exam, night, sex, sauna] }),
};
