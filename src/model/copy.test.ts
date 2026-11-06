import { describe, expect, it } from "vitest";
import { assess } from "./assess/assess";
import { Assessment, Reading } from "./assess/types";
import { ReadingId } from "./ids";
import { maxHeartRate } from "./events";
import { MUSCLE_GROUPS } from "./muscleGroups";
import { openingReply, readout } from "./readout";
import { processesAt } from "./processes/processes";
import { simulate } from "./engine/simulate";
import { Trajectory, value } from "./engine/trajectory";
import { formatClock, whenWords } from "./words";
import { SYSTEMS } from "./systems";
import { threadsAt } from "./threads";
import { hm } from "./testKit";
import { coffee, day, food, pizza, runAt, SCENARIOS, woman } from "./testScenarios";

const words = (text: string) => text.trim().split(/\s+/).length;

const reading = (a: Assessment, id: ReadingId): Reading => {
  const found = a.readings.find((r) => r.id === id);
  if (!found) throw new Error(`Missing reading ${id}`);
  return found;
};
const TRAJECTORIES = new Map(Object.entries(SCENARIOS).map(([name, scenario]) => [name, simulate(scenario)]));
const trajectoryOf = (name: string) => {
  const found = TRAJECTORIES.get(name);
  if (!found) throw new Error(`No scenario ${name}`);
  return found;
};
const at = (name: string, t: number) => assess(trajectoryOf(name), t);
const MINUTES: number[] = [];
for (let t = hm(6); t <= hm(26); t += 2) MINUTES.push(t);

// Every word on screen at one moment. Sources are citations and stay as written.
function shownAt(tr: Trajectory, t: number): string[] {
  const a = assess(tr, t);
  const out = [a.headline];
  for (const r of a.readings) out.push(r.label, r.display, r.unit, r.verdictWord, r.why, r.forecast ?? "");
  for (const f of a.feelings) out.push(f.label, f.word, f.cause, f.when ?? "");
  for (const s of Object.values(a.systems)) out.push(s.word, s.sentence);
  for (const m of a.muscles) out.push(m.status, m.sorenessLine ?? "", m.normalLine ?? "");
  for (const p of processesAt(tr, t)) {
    out.push(p.title, p.headline);
    for (const s of p.stops) out.push(s.label, s.reading, s.say);
  }
  for (const thread of threadsAt(tr, t)) out.push(thread.title, thread.since, thread.status);
  return out;
}

const BROKEN = /NaN|undefined|Infinity|\bnull\b|\[object|\bthe the\b|\ba a\b|\bof of\b|  |\.\./;
const RETIRED = /\bdone\b|\b\d+ of 100\b|\bblocking\b|thermostat|set point|you should feel|strength lost|receptors blocked|low fluid|reward signals|brainstem|liver glycogen/i;
const BAD_GRAMMAR = /\bthe stress\b|(?<![.\d])1(\.0)? hours\b|\b1 minutes\b|\b(cold|flu|exam|stress|workout) pull\b|\bmuscles? adds\b|\band triceps adds\b|\bis raising it\b/i;
const CONTRAST = /\bnot just\b|\brather than\b|\bnot only\b|\bbut not\b|\binstead of\b/i;
const FALSE_ALARM = /blood sugar is low|\b4[0-9] h\b/i;
const FORBIDDEN_WORDS = Object.entries({ BROKEN, RETIRED, BAD_GRAMMAR, CONTRAST, FALSE_ALARM });

describe("the sweep from 06:00 to 26:00", () => {
  for (const name of Object.keys(SCENARIOS)) {
    const tr = trajectoryOf(name);

    it(`shows no broken or retired words: ${name}`, () => {
      const problems: string[] = [];
      for (const t of MINUTES) {
        for (const text of shownAt(tr, t)) {
          for (const [rule, pattern] of FORBIDDEN_WORDS) if (pattern.test(text)) problems.push(`${rule} at ${formatClock(t)}: ${text}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it(`keeps to the word limits: ${name}`, () => {
      for (const t of MINUTES) {
        const a = assess(tr, t);
        for (const [id, s] of Object.entries(a.systems)) {
          expect(words(s.sentence), `${id}: ${s.sentence}`).toBeLessThan(14);
          expect(words(s.word), s.word).toBeLessThanOrEqual(3);
          if (id === "overview") expect(s.sentence).toBe(a.headline);
        }
        for (const r of a.readings) expect(words(r.why), r.why).toBeLessThanOrEqual(10);
        expect(a.feelings.length).toBeLessThanOrEqual(3);
        for (const f of a.feelings) expect(words(f.cause), f.cause).toBeLessThanOrEqual(10);
        for (const thread of threadsAt(tr, t)) expect(words(thread.status), thread.status).toBeLessThanOrEqual(2);
        for (const p of processesAt(tr, t)) for (const s of p.stops) expect(words(s.say), s.say).toBeLessThanOrEqual(25);
      }
    });

    it(`keeps the contract with the interface: ${name}`, () => {
      for (const t of MINUTES) {
        const a = assess(tr, t);
        const systems = Object.values(a.systems);
        expect(systems.filter((s) => s.emphasis).length).toBeLessThanOrEqual(3);
        for (const s of systems) if (s.emphasis) expect(s.quiet).toBe(false);
        expect(a.systems.overview.emphasis).toBe(false);
        for (const id of ["alertness", "stressLevel", "reward", "inflammation", "immune"] as const) {
          expect(reading(a, id).unit).toBe("");
          expect(reading(a, id).display).toMatch(/^(Quiet|Mild|Moderate|Strong)$/);
        }
        const sentences = new Set(systems.map((s) => s.sentence));
        for (const p of processesAt(tr, t)) {
          expect(sentences.has(p.headline), p.headline).toBe(false);
          for (const s of p.stops) if (s.state === "passed") expect(s.reading).toBe("");
        }
        const threads = threadsAt(tr, t);
        const ranks = threads.map((thread) => thread.importance);
        expect([...ranks].sort((x, y) => y - x)).toEqual(ranks);
      }
    });
  }

  it("gives Claude the same words, and no scale as a number", () => {
    for (const tr of TRAJECTORIES.values()) {
      for (const t of [hm(8), hm(17), hm(23)]) {
        const text = JSON.stringify(readout(tr, t));
        expect(text).not.toMatch(/NaN|\b\d+ of 100\b/);
      }
    }
  });
});

describe("the systems' lists", () => {
  it("holds at most four primary readings, with the rest under more and none repeated", () => {
    for (const system of SYSTEMS) {
      expect(system.readings.length).toBeLessThanOrEqual(4);
      const all = [...system.readings, ...system.more];
      expect(new Set(all).size).toBe(all.length);
    }
    const muscles = SYSTEMS.find((s) => s.id === "muscles");
    expect([...(muscles?.readings ?? []), ...(muscles?.more ?? [])]).toHaveLength(MUSCLE_GROUPS.length);
  });
});

describe("false alarms", () => {
  const glucoseLow = (name: string) => MINUTES.filter((t) => reading(at(name, t), "glucose").verdict === "low");

  it("never calls sugar low after a normal meal, a walk or a run", () => {
    for (const name of ["three meals", "two apples", "banana", "rice", "the opening day", "a walk after a meal", "a run after breakfast", "a fasted run", "cola"]) {
      expect(glucoseLow(name), name).toEqual([]);
    }
  });

  it("calls the dip after 75 g of glucose a dip, in calm words", () => {
    const tr = trajectoryOf("75 g of glucose");
    let dipped = 0;
    for (let t = hm(10); t <= hm(14); t++) {
      const g = reading(assess(tr, t), "glucose");
      expect(g.verdict, formatClock(t)).not.toBe("low");
      if (g.verdictWord === "A dip") {
        dipped++;
        expect(g.tone).toBe("calm");
      }
    }
    expect(dipped).toBeGreaterThan(0);
  });

  it("calls a peak over 7.8 within 90 minutes of carbs expected", () => {
    const tr = trajectoryOf("75 g of glucose");
    const g = reading(assess(tr, hm(9, 41)), "glucose");
    expect(g.value).toBeGreaterThan(7.8);
    expect(g.verdictWord).toBe("Expected");
  });

  it("reads a normal evening's alertness as moderate and normal", () => {
    const a = reading(at("three meals", hm(20, 30)), "alertness");
    expect(a.display).toBe("Moderate");
    expect(a.verdict).toBe("normal");
  });

  it("reads a short night as low, in words", () => {
    const a = reading(at("a short night", hm(15)), "alertness");
    expect(a.display).toBe("Mild");
    expect(a.verdict).toBe("low");
  });

  it("calls hunger at full intensity strong, even as it fades", () => {
    const tr = simulate(day([food("snack", "Snack", hm(15), { grams: 50, waterMl: 10, carbsG: 20, sugarG: 10 })]));
    for (let t = hm(11); t < hm(16); t += 5) {
      const hungry = assess(tr, t).feelings.find((f) => f.id === "hungry");
      if (hungry && hungry.intensity >= 0.75) expect(hungry.word).toBe("Strong");
    }
  });

  it("never blames a missed lunch the next morning", () => {
    const tr = simulate(day([food("snack", "Snack", hm(16), { grams: 50, waterMl: 10, carbsG: 10 })]));
    for (let t = hm(24); t <= hm(29); t += 15) expect(reading(assess(tr, t), "glycogen").why).not.toContain("lunch");
  });

  it("says nothing is out of range only when nothing is, never next to a fever", () => {
    const a = at("flu", hm(16));
    expect(reading(a, "temperature").verdictWord).toBe("Fever");
    expect(a.headline).not.toContain("Nothing is out of range");
    expect(at("nothing logged", hm(10)).headline).toContain("Nothing is out of range");
  });

  it("stops saying training 15 minutes after the session", () => {
    const later = at("chest and triceps", hm(9, 15));
    expect(later.headline).not.toContain("Training");
    expect(later.systems.overview.word).not.toBe("Training");
    expect(at("chest and triceps", hm(8, 30)).headline).toContain("Training your chest and triceps");
  });

  it("keeps a run under your maximum, so a run reads as expected at any age", () => {
    const older = simulate({ ...day([], { activities: runAt(hm(10), hm(11)) }), body: { ...woman, age: 75 } });
    expect(value(older, "hr", hm(10, 30))).toBeLessThanOrEqual(maxHeartRate(75) * 0.9);
    expect(reading(assess(older, hm(10, 30)), "hr").verdictWord).toBe("Expected");
  });

  it("does not raise a heart rate that a meal explains", () => {
    const hr = reading(at("three meals", hm(14)), "hr");
    expect(hr.value).toBeGreaterThan(72);
    expect(hr.verdictWord).toBe("Expected");
    expect(at("three meals", hm(14)).systems.circulation.quiet).toBe(true);
  });

  it("does not call a workout stress", () => {
    expect(at("chest and triceps", hm(8, 30)).systems.brain.word).not.toBe("Stressed");
    expect(at("an exam", hm(14, 20)).systems.brain.word).toBe("Stressed");
  });
});

describe("false reassurance", () => {
  const during = at("a run after breakfast", hm(10, 40));

  it("does not call a running temperature your daily rhythm", () => {
    expect(reading(during, "temperature").value).toBeGreaterThan(37.5);
    expect(reading(during, "temperature").why).toBe("Working muscles make heat");
    const after = at("a run after breakfast", hm(11, 10));
    expect(reading(after, "temperature").why).toBe("Cooling down after running");
  });

  it("counts what a run costs in water", () => {
    expect(reading(during, "fluid").value).toBeLessThan(-0.5);
    expect(reading(during, "fluid").why).toContain("sweat");
    expect(during.feelings.map((f) => f.id)).toContain("breathless");
  });

  it("does not call gut flow usual during a run", () => {
    const gut = reading(during, "flowGut");
    expect(gut.value).toBeLessThan(10);
    expect(gut.why).toBe("Your working muscles are taking the blood");
    const line = processesAt(trajectoryOf("a run after breakfast"), hm(10, 40)).find((p) => p.id === "circulation");
    expect(line?.stops.find((s) => s.id === "gut")?.say).toContain("Down from 25%");
  });

  it("gives thirst its due on a day with nothing drunk", () => {
    const a = at("nothing logged", hm(23));
    expect(reading(a, "fluid").verdictWord).toBe("A little dry");
    expect(a.feelings.map((f) => f.id)).toContain("thirsty");
  });
});

describe("grammar, at the template", () => {
  it("names stress plainly", () => {
    const a = at("stress", hm(14, 20));
    expect(reading(a, "stressLevel").why).toBe("Raised by stress");
    expect(reading(a, "hr").why).toMatch(/^About \d+ bpm from stress$/);
  });

  it("agrees with a label that names two muscles", () => {
    expect(reading(at("chest and triceps", hm(8, 30)), "hr").why).toBe("About 51 bpm from the chest and triceps workout");
  });

  it("agrees with a cold", () => {
    expect(reading(at("a cold", hm(14)), "alertness").why).toContain("Lowered by");
  });

  it("says one hour", () => {
    const line = processesAt(simulate(day([coffee])), hm(8, 30)).find((p) => p.id === "alertness");
    expect(line?.headline).toContain("1 hour awake");
  });
});

describe("contradictions", () => {
  it("says only the first sugar has reached your blood while it is being absorbed", () => {
    const tr = simulate(day([pizza]));
    const t = hm(17, 20);
    expect(reading(assess(tr, t), "absorbing").value).toBeGreaterThan(0);
    expect(processesAt(tr, t).find((p) => p.id === "intake:pizza")?.headline).toContain("only the first sugar has reached your blood");
  });

  it("names a day and a time of day past 24 hours, in the same words everywhere", () => {
    expect(whenWords(hm(18, 20), hm(17))).toBe("near 18:20");
    expect(whenWords(hm(24 + 19), hm(17))).toBe("tomorrow evening");
    expect(whenWords(hm(24 + 9), hm(17))).toBe("tomorrow morning");
    expect(whenWords(hm(48 + 9), hm(17))).toBe("in 2 days");
    const a = at("chest and triceps", hm(14));
    expect(a.systems.muscles.sentence).toContain("Soreness peaks in 2 days");
    expect(reading(a, "muscle:chest").forecast).toBe("Soreness peaks in 2 days");
    const line = processesAt(trajectoryOf("chest and triceps"), hm(14)).find((p) => p.id === "event:chest");
    expect(line?.headline).toContain("soreness peaks in 2 days");
  });

  it("gives the same time for the same sleepy moment", () => {
    const tr = trajectoryOf("the opening day");
    const t = hm(17);
    const caption = openingReply(tr, t)[0].text;
    const when = caption.match(/near (\d\d:\d\d)/)?.[1];
    expect(when).toBeDefined();
    const sentence = assess(tr, t).systems.brain.sentence;
    if (sentence.includes("most near")) expect(sentence).toContain(when);
    const feeling = [hm(17), hm(17, 5)].flatMap((m) => assess(tr, m).feelings).find((f) => f.id === "sleepy");
    if (feeling?.when) expect(feeling.when).toContain(when);
  });

  it("keeps the cough one story", () => {
    const line = processesAt(trajectoryOf("a cold"), hm(14)).find((p) => p.id === "event:cold");
    expect(line?.stops.find((s) => s.label === "Cough reflex")?.reading).toBe("Active");
    expect(at("a cold", hm(14)).feelings.map((f) => f.id)).toContain("coughing");
  });
});

describe("the words people read", () => {
  it("names liver fuel, and keeps glycogen in the hover text", () => {
    const fuel = reading(at("nothing logged", hm(10)), "glycogen");
    expect(fuel.label).toBe("Liver fuel");
    expect(fuel.scale.typicalLabel).toContain("glycogen");
  });

  it("says a little dry and feel-good chemicals, and tired signal blocked", () => {
    expect(reading(at("nothing logged", hm(22)), "fluid").verdictWord).toBe("A little dry");
    expect(reading(at("sex", hm(21, 15)), "reward").label).toBe("Feel-good chemicals");
    expect(reading(at("the opening day", hm(17)), "receptors").label).toBe("Tired signal blocked");
  });

  it("names the fact in the rail where it matters", () => {
    expect(at("flu", hm(16)).systems.immune.word).toMatch(/^Fever 38\.\d$/);
    expect(at("the opening day", hm(17)).systems.energy.word).toBe("Liver fuel low");
    expect(at("three meals", hm(14)).systems.digestion.word).toBe("Working hard");
  });

  it("gives each process a plain title", () => {
    const titles = (name: string, t: number) => threadsAt(trajectoryOf(name), t).map((x) => x.title);
    expect(titles("a cold", hm(17))).toEqual(["Cold", "Ate pizza", "Drank coffee"]);
    expect(titles("chest and triceps", hm(9))).toEqual(["Chest and triceps workout"]);
    expect(titles("the opening day", hm(17))).toEqual(["Ate sugar bar and pizza", "Drank coffee"]);
    expect(titles("a beer, pizza and a pill", hm(20))).toEqual(["Drank beer", "Ate pizza", "Took ibuprofen"]);
  });

  it("uses the app's one accent for every process line", () => {
    for (const tr of TRAJECTORIES.values()) {
      for (const p of processesAt(tr, hm(17))) expect(["chyme", "glucose", "fat", "caffeine", "insulin", "alcohol", "other"]).toContain(p.substance);
    }
  });
});
