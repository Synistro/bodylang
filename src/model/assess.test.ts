import { describe, expect, it } from "vitest";
import { Assessment, assess, glucoseVerdict, insulinVerdict, Reading, triglycerideVerdict } from "./assess";
import { ReadingId } from "./ids";
import { MUSCLE_GROUPS } from "./muscleGroups";
import { simulate } from "./engine/simulate";
import { CustomSubstance, Intake, Scenario } from "./scenario";
import { SYSTEMS } from "./systems";
import { hm, NO_NUTRIENTS } from "./testKit";


const coffee: Intake = { ...NO_NUTRIENTS, id: "coffee", label: "Coffee", at: hm(8, 30), grams: 250, waterMl: 250, caffeineMg: 95, liquid: true };
const sugarBar: Intake = { ...NO_NUTRIENTS, id: "sugar_bar", label: "Sugar bar", at: hm(16, 45), grams: 50, waterMl: 3, carbsG: 31, sugarG: 27, fatG: 12, proteinG: 4, fiberG: 1 };
const pizza: Intake = { ...NO_NUTRIENTS, id: "pizza", label: "Pizza", at: hm(16, 45), grams: 240, waterMl: 110, carbsG: 72, sugarG: 8, fatG: 26, proteinG: 28, fiberG: 4 };
const beer: Intake = { ...NO_NUTRIENTS, id: "beer", label: "Beer", at: hm(19), grams: 500, waterMl: 460, carbsG: 18, sugarG: 1, alcoholG: 20, liquid: true };
const ibuprofen: CustomSubstance = { id: "ibuprofen", label: "Ibuprofen", at: hm(13), doseMg: 400, tmaxMin: 90, halfLifeH: 2, volumeLPerKg: 0.15, bioavailability: 0.9, targets: [{ organ: "brain", effect: "blocks the signal that makes pain" }], source: "test" };

const day: Scenario = {
  body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
  activities: [{ from: hm(8), posture: "sitting" }],
  substances: [],
  intakes: [coffee, sugarBar, pizza],
};

const tr = simulate(day);
const readingAt = (t: number, id: ReadingId, trajectory = tr): Reading => {
  const found = assess(trajectory, t).readings.find((r) => r.id === id);
  if (!found) throw new Error(`Missing reading ${id}`);
  return found;
};

const ALL_READINGS: ReadingId[] = [
  "cycleDay",
  "estradiol",
  "progesterone",
  "glucose",
  "insulin",
  "tg",
  "hr",
  "output",
  "bloodPressure",
  "breaths",
  "flowGut",
  "flowMuscle",
  "flowBrain",
  "flowKidneys",
  "stomach",
  "absorbing",
  "glycogen",
  "muscleUptake",
  "burn",
  "fuel",
  "caffeine",
  "receptors",
  "alertness",
  "stressLevel",
  "reward",
  "temperature",
  "inflammation",
  "immune",
  "alcohol",
  "bladder",
  "fluid",
  ...MUSCLE_GROUPS.map((group): ReadingId => `muscle:${group}`),
];

const WORD_SCALES: ReadingId[] = ["alertness", "stressLevel", "reward", "inflammation", "immune"];

const words = (text: string) => text.trim().split(/\s+/).length;

// Every string a person could read in an assessment.
function stringsIn(a: Assessment): string[] {
  const out = [a.headline, ...a.notable.map((n) => n.text)];
  for (const r of a.readings) out.push(r.label, r.display, r.unit, r.verdictWord, r.why, r.forecast ?? "", r.source, r.scale.typicalLabel);
  for (const f of a.feelings) out.push(f.label, f.word, f.cause, f.when ?? "");
  for (const s of Object.values(a.systems)) out.push(s.word);
  return out;
}

const SCENARIOS: Record<string, Scenario> = {
  "the test day": day,
  "nothing logged": { ...day, intakes: [] },
  "a drink only": { ...day, intakes: [{ ...NO_NUTRIENTS, id: "water", label: "Water", at: hm(9), grams: 500, waterMl: 500, liquid: true }] },
  "pure spirit": { ...day, intakes: [{ ...NO_NUTRIENTS, id: "vodka", label: "Vodka", at: hm(20), grams: 60, waterMl: 40, alcoholG: 20, liquid: true }] },
  "a beer and a pill": { ...day, intakes: [beer, pizza], substances: [ibuprofen] },
  "a walk and a run": { ...day, activities: [{ from: hm(8), posture: "sitting" }, { from: hm(17), posture: "walking" }, { from: hm(18), posture: "running" }, { from: hm(19), posture: "standing" }, { from: hm(23), posture: "sleeping" }] },
  "another body": { ...day, body: { sex: "female", age: 62, heightCm: 158, weightKg: 92 } },
};

describe("verdict logic", () => {
  it("calls the same insulin expected after a meal and high when fasting", () => {
    expect(insulinVerdict(5, "fed").verdict).toBe("expected");
    expect(insulinVerdict(5, "fasting").verdict).toBe("high");
    expect(insulinVerdict(5, "fasting").tone).toBe("concern");
    expect(insulinVerdict(1, "fasting").verdict).toBe("normal");
  });

  it("calls the same blood fat expected after a fatty meal and high when fasting", () => {
    expect(triglycerideVerdict(200, { afterFattyMeal: true, fasting: false }).verdict).toBe("expected");
    expect(triglycerideVerdict(200, { afterFattyMeal: false, fasting: true }).verdict).toBe("high");
    expect(triglycerideVerdict(160, { afterFattyMeal: false, fasting: true }).verdict).toBe("raised");
    expect(triglycerideVerdict(101, { afterFattyMeal: true, fasting: false }).verdict).toBe("normal");
    expect(triglycerideVerdict(500, { afterFattyMeal: true, fasting: false }).verdict).toBe("high");
  });

  it("judges blood sugar against fasting and after-meal cutoffs", () => {
    const fasting = { fasting: true, withinPeak: false, withinMeal: false, afterCarbs: false };
    const peak = { fasting: false, withinPeak: true, withinMeal: true, afterCarbs: true };
    const meal = { fasting: false, withinPeak: false, withinMeal: true, afterCarbs: true };
    const later = { fasting: false, withinPeak: false, withinMeal: false, afterCarbs: true };
    expect(glucoseVerdict(5, fasting).verdict).toBe("normal");
    expect(glucoseVerdict(6.5, fasting).verdict).toBe("raised");
    expect(glucoseVerdict(7.5, fasting).verdict).toBe("high");
    expect(glucoseVerdict(7.5, meal).verdict).toBe("normal");
    expect(glucoseVerdict(9, peak).verdict).toBe("expected");
    expect(glucoseVerdict(9, meal).verdict).toBe("raised");
    expect(glucoseVerdict(9, later).verdict).toBe("high");
    expect(glucoseVerdict(12, meal).verdict).toBe("high");
    expect(glucoseVerdict(3.8, fasting).verdict).toBe("low");
    expect(glucoseVerdict(3.8, later).word).toBe("A dip");
    expect(glucoseVerdict(3.8, later).tone).toBe("calm");
    expect(glucoseVerdict(3.4, later).verdict).toBe("low");
    expect(glucoseVerdict(2.8, fasting).word).toBe("Very low");
  });
});

describe("fasting at 12:00", () => {
  const a = assess(tr, hm(12));
  const at = (id: ReadingId) => readingAt(hm(12), id);

  it("treats a black coffee as still fasting", () => {
    expect(at("glucose").scale.typicalLabel).toContain("fasting");
    expect(at("glucose").verdict).toBe("normal");
    expect(at("insulin").verdict).toBe("normal");
    expect(at("insulin").value).toBeGreaterThan(0.85);
    expect(at("insulin").value).toBeLessThan(1);
    expect(at("tg").verdict).toBe("normal");
    expect(at("tg").scale.typicalHigh).toBe(150);
    expect(at("stomach").verdictWord).toBe("Empty");
    expect(at("caffeine").verdict).toBe("expected");
  });

  it("says nothing stands out", () => {
    expect(a.notable).toEqual([]);
    expect(a.headline).toContain("Nothing is out of range");
    expect(a.headline).toContain("coffee");
  });

  it("feels hungry because no food is logged", () => {
    expect(a.feelings[0].id).toBe("hungry");
    expect(a.feelings[0].cause).toContain("no food");
  });

  it("reports a true peak when a logged meal is past the look-ahead window", () => {
    expect(at("glucose").forecast).toBe("Peaks at 6.9 near 17:53");
    expect(at("insulin").forecast).toBe("Peaks at 5.0× near 17:59");
  });
});

describe("17:00, fifteen minutes after the sugar bar and pizza", () => {
  const a = assess(tr, hm(17));
  const at = (id: ReadingId) => readingAt(hm(17), id);

  it("matches the blood sugar line of the design", () => {
    const g = at("glucose");
    expect(g.display).toBe("4.7");
    expect(g.verdictWord).toBe("Normal");
    expect(g.scale.typicalLabel).toBe("3.9 to 7.8 mmol/L after a meal");
    expect(g.why).toBe("Food hasn't reached your intestine yet");
    expect(g.forecast).toBe("Peaks at 6.9 near 17:53");
    expect(g.heading).toBeCloseTo(7, 0);
    expect(readingAt(hm(17, 30), "glucose").trend).toBe("rising");
    expect(readingAt(hm(17, 30), "glucose").why).toBe("Sugar from the pizza and sugar bar is arriving");
  });

  it("matches the insulin line", () => {
    const i = at("insulin");
    expect(i.trend).toBe("rising");
    expect(i.scale.typicalLabel).toBe("Rises after food");
    const later = readingAt(hm(17, 30), "insulin");
    expect(later.verdict).toBe("expected");
    expect(later.why).toBe("It's following the sugar");
  });

  it("matches the blood fat line", () => {
    const t = at("tg");
    expect(t.verdictWord).toBe("Normal");
    expect(t.why).toBe("The meal's fat hasn't arrived yet");
    expect(t.forecast).toMatch(/^Peaks at 1[34]\d near 19:|^Peaks at 1[34]\d near 20:/);
  });

  it("matches the heart line", () => {
    const h = at("hr");
    expect(h.verdictWord).toBe("Expected");
    expect(h.tone).toBe("calm");
    expect(h.why).toMatch(/^About \d bpm from digestion/);
    const later = readingAt(hm(18), "hr");
    expect(later.verdictWord).toBe("Expected");
    expect(later.why).toMatch(/^About 9 bpm from digestion/);
  });

  it("matches the liver line", () => {
    const l = at("glycogen");
    expect(l.label).toBe("Liver fuel");
    expect(l.verdict).toBe("low");
    expect(l.tone).toBe("note");
    expect(l.why).toContain("You logged no lunch");
  });

  it("leads with what is going on and lists only what stands out", () => {
    expect(a.headline).toBe("Digesting a big meal.");
    expect(a.notable.map((n) => n.reading)).toEqual(["glycogen"]);
  });

  it("gives feelings a cause and a time, strongest first", () => {
    const feelingsOfDay = [17.5, 18, 18.5, 19, 19.5, 20].flatMap((h) => assess(tr, h * 60).feelings);
    expect(a.feelings.length).toBeLessThanOrEqual(3);
    expect(a.feelings[0].id).toBe("full");
    const intensities = a.feelings.map((f) => f.intensity);
    expect([...intensities].sort((x, y) => y - x)).toEqual(intensities);
    expect(a.feelings[0].cause).toMatch(/^Your stomach holds \d+ ml$/);
    const sleepy = feelingsOfDay.find((f) => f.id === "sleepy");
    expect(sleepy?.cause).toContain("kcal at 16:45");
  });

  it("describes each system in the rail", () => {
    expect(a.systems.digestion.word).toBe("Working hard");
    expect(a.systems.energy.word).toBe("Liver fuel low");
    expect(a.systems.brain.word).toBe("Caffeine fading");
    expect(a.systems.clearing.word).toBe("Quiet");
    expect(a.systems.overview.word).toBe("Digesting");
    for (const s of Object.values(a.systems)) {
      expect(s.level).toBeGreaterThanOrEqual(0);
      expect(s.level).toBeLessThanOrEqual(1);
      expect(words(s.word)).toBeLessThanOrEqual(3);
    }
  });
});

describe("later in the same meal", () => {
  it("calls insulin near five times rest expected", () => {
    const i = readingAt(hm(17, 48), "insulin");
    expect(i.value).toBeGreaterThan(4.5);
    expect(i.verdict).toBe("expected");
  });

  it("calls blood fat above 150 expected hours after a fatty meal", () => {
    const fatty = simulate({ ...day, intakes: [{ ...NO_NUTRIENTS, id: "test_meal", label: "Fat test", at: hm(9), grams: 300, waterMl: 150, carbsG: 25, sugarG: 15, fatG: 75, proteinG: 10 }] });
    const t = readingAt(hm(12, 15), "tg", fatty);
    expect(t.value).toBeGreaterThan(180);
    expect(t.verdict).toBe("expected");
    expect(t.tone).toBe("calm");
  });

  it("names the cause of a falling reading", () => {
    expect(readingAt(hm(18), "glucose").why).toBe("Insulin is moving sugar into muscle and liver");
    expect(readingAt(hm(21), "tg").why).toBe("Your fat tissue is pulling meal fat out");
  });

  it("compares the trend a few minutes either side", () => {
    expect(readingAt(hm(17), "stomach").trend).toBe("falling");
    expect(readingAt(hm(12), "glucose").trend).toBe("steady");
    expect(readingAt(hm(19, 50), "tg").trend).toBe("steady");
    expect(readingAt(hm(23), "tg").trend).toBe("falling");
  });

  it("does not feel low through a dip that stays in the normal range", () => {
    expect(readingAt(hm(23, 15), "glucose").verdict).toBe("normal");
    expect(assess(tr, hm(23, 15)).feelings.map((f) => f.id)).not.toContain("low");
  });

  it("calls climbing back from a dip a recovery, with no peak", () => {
    expect(readingAt(hm(24), "glucose").forecast).toMatch(/^Back to 4\.\d near /);
    expect(readingAt(hm(24), "glucose").why).toBe("A small dip after the meal");
  });

  it("stops promising an insulin rise once the sugar has gone", () => {
    expect(readingAt(hm(24), "insulin").why).toBe("At its resting level");
  });

  it("only forecasts turns within the next few hours", () => {
    expect(readingAt(hm(20, 16), "alertness").forecast ?? "").not.toContain("06:00");
    expect(assess(tr, hm(23)).feelings.find((f) => f.id === "sleepy")?.when).toBeNull();
  });

  it("forecasts when the bladder will need emptying", () => {
    expect(readingAt(hm(17), "bladder").forecast).toMatch(/^You'll want to go near \d\d:\d\d$/);
  });
});

describe("other bodies and days", () => {
  it("blames the meal doing the work for sleepiness, even after a later drink", () => {
    const night = simulate(SCENARIOS["a beer and a pill"]);
    const sleepy = assess(night, hm(19, 30)).feelings.find((f) => f.id === "sleepy");
    expect(sleepy?.cause).toBe("You ate 618 kcal at 16:45");
  });

  it("expects a fast heart while moving and names the walk", () => {
    const walking = simulate(SCENARIOS["a walk and a run"]);
    const h = readingAt(hm(17, 30), "hr", walking);
    expect(h.verdict).toBe("expected");
    expect(h.why).toMatch(/^About \d+ bpm from walking/);
    expect(readingAt(hm(17, 30), "flowMuscle", walking).why).toContain("Walking");
    expect(assess(walking, hm(17, 30)).headline).toContain("Walking");
  });

  it("flags alcohol at the drink-driving limit", () => {
    const drinks: Intake[] = [0, 1, 2, 3].map((n) => ({ ...beer, id: `beer_${n}`, at: hm(19) + n * 10 }));
    const night = simulate({ ...day, intakes: drinks });
    const a = readingAt(hm(20), "alcohol", night);
    expect(a.value).toBeGreaterThan(0.5);
    expect(a.verdict).toBe("high");
    expect(a.tone).toBe("concern");
    expect(assess(night, hm(20)).notable.map((n) => n.reading)).toContain("alcohol");
  });

  it("warns when late caffeine lasts until bedtime", () => {
    const late = simulate({ ...day, intakes: [{ ...coffee, at: hm(19), caffeineMg: 200 }] });
    const c = readingAt(hm(20), "caffeine", late);
    expect(c.tone).toBe("note");
    expect(c.forecast).toContain("may cost you sleep");
  });

  it("calls food in a fasting body fed the moment it lands", () => {
    expect(readingAt(hm(16, 46), "glucose").scale.typicalLabel).toContain("after a meal");
  });

  it("names no food when nothing has been eaten", () => {
    const empty = simulate(SCENARIOS["nothing logged"]);
    const a = assess(empty, hm(13));
    expect(a.headline).toBe("On stored fuel. Nothing is out of range.");
    expect(readingAt(hm(13), "glucose", empty).why).toBe("Your liver is holding it steady from stores");
    expect(readingAt(hm(13), "caffeine", empty).verdictWord).toBe("None");
  });

  it("omits feelings while asleep", () => {
    expect(assess(tr, hm(6)).feelings).toEqual([]);
    expect(assess(tr, hm(6)).headline).toContain("Asleep");
    expect(readingAt(hm(6), "bladder").tone).toBe("calm");
  });

  it("names at most two foods and then calls it the meal", () => {
    const buffet = simulate({ ...day, intakes: [{ ...pizza, id: "a", label: "Pasta" }, { ...pizza, id: "b", label: "Bread" }, { ...pizza, id: "c", label: "Cake" }] });
    expect(readingAt(hm(17, 10), "glucose", buffet).why).toBe("Sugar from the meal is arriving");
  });
});

describe("the reading table", () => {
  it("builds every reading with a real range, source and curve", () => {
    const a = assess(tr, hm(17));
    expect(a.readings.map((r) => r.id).sort()).toEqual([...ALL_READINGS].sort());
    for (const r of a.readings) {
      expect(r.label).not.toBe("");
      expect(r.display).not.toBe("");
      // A 0 to 100 scale reads as a word, so it has no unit.
      if (WORD_SCALES.includes(r.id)) expect(r.unit).toBe("");
      else if (!r.id.startsWith("muscle:")) expect(r.unit).not.toBe("");
      expect(r.why).not.toBe("");
      expect(r.source).not.toBe("");
      if (!r.id.startsWith("muscle:")) expect(r.series).not.toBeNull();
      expect(r.scale.max).toBeGreaterThan(r.scale.min);
      expect(r.scale.typicalHigh).toBeGreaterThan(r.scale.typicalLow);
      expect(r.scale.typicalHigh).toBeLessThanOrEqual(r.scale.max);
    }
  });

  it("marks my own estimates as weakest evidence", () => {
    for (const t of [hm(12), hm(17)]) {
      for (const r of assess(tr, t).readings) {
        if (r.source.startsWith("My estimate")) expect(r.evidence).toBe("C");
      }
    }
  });

  it("covers every reading a system asks for", () => {
    for (const system of SYSTEMS) for (const id of system.readings) expect(ALL_READINGS).toContain(id);
  });
});

describe("every minute of every kind of day", () => {
  const minutes: number[] = [];
  for (let t = hm(6); t <= hm(26); t++) minutes.push(t);

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const trajectory = simulate(scenario);

    it(`writes no broken strings or numbers: ${name}`, () => {
      for (const t of minutes) {
        const a = assess(trajectory, t);
        for (const text of stringsIn(a)) {
          expect(text).not.toMatch(/NaN|undefined|Infinity|null/);
        }
        for (const r of a.readings) {
          expect(Number.isFinite(r.value)).toBe(true);
          if (r.heading !== null) expect(Number.isFinite(r.heading)).toBe(true);
        }
        for (const f of a.feelings) {
          expect(f.intensity).toBeGreaterThanOrEqual(0.12);
          expect(f.intensity).toBeLessThanOrEqual(1);
        }
      }
    });

    it(`keeps the copy short and plain: ${name}`, () => {
      for (const t of minutes) {
        const a = assess(trajectory, t);
        for (const r of a.readings) expect(words(r.why), r.why).toBeLessThanOrEqual(10);
        for (const f of a.feelings) expect(words(f.cause), f.cause).toBeLessThanOrEqual(10);
        for (const text of stringsIn(a)) expect(text).not.toMatch(/\bnot just\b|\brather than\b|\bbut not\b|\bnot only\b/i);
      }
    });
  }
});

it("handles a fractional minute and the ends of the day", () => {
  for (const t of [0, 0.5, 1020.4, 1800]) {
    for (const text of stringsIn(assess(tr, t))) expect(text).not.toMatch(/NaN|undefined/);
  }
});
