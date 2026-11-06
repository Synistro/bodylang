import { describe, expect, it } from "vitest";
import { readout } from "./narrate";
import { Process, processesAt, processesFor, ProcessStop } from "./processes";
import { simulate } from "./simulate";
import { caffeineLedgerAt, ledgerAt, value } from "./engine/trajectory";
import { CustomSubstance, Intake, Scenario } from "./scenario";
import { hm, NO_NUTRIENTS } from "./testKit";


const coffee: Intake = { ...NO_NUTRIENTS, id: "coffee", label: "Coffee", at: hm(8, 30), grams: 250, waterMl: 250, caffeineMg: 95, liquid: true };
const sugarBar: Intake = { ...NO_NUTRIENTS, id: "sugar_bar", label: "Sugar bar", at: hm(16, 45), grams: 50, waterMl: 3, carbsG: 31, sugarG: 27, fatG: 12, proteinG: 4, fiberG: 1 };
const pizza: Intake = { ...NO_NUTRIENTS, id: "pizza", label: "Pizza", at: hm(16, 45), grams: 240, waterMl: 110, carbsG: 72, sugarG: 8, fatG: 26, proteinG: 28, fiberG: 4 };
const beer: Intake = { ...NO_NUTRIENTS, id: "beer", label: "Beer", at: hm(19), grams: 500, waterMl: 460, carbsG: 18, sugarG: 1, alcoholG: 20, liquid: true };
const vodka: Intake = { ...NO_NUTRIENTS, id: "vodka", label: "Vodka", at: hm(20), grams: 60, waterMl: 40, alcoholG: 20, liquid: true };
const latte: Intake = { ...NO_NUTRIENTS, id: "latte", label: "Latte", at: hm(9), grams: 350, waterMl: 320, carbsG: 14, sugarG: 14, fatG: 9, proteinG: 9, caffeineMg: 80, liquid: true };
const ibuprofen: CustomSubstance = { id: "ibuprofen", label: "Ibuprofen", at: hm(13), doseMg: 400, tmaxMin: 90, halfLifeH: 2, volumeLPerKg: 0.15, bioavailability: 0.9, targets: [{ organ: "brain", effect: "blocks the signal that makes pain" }], source: "test" };

const day: Scenario = {
  body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
  activities: [{ from: hm(8), posture: "sitting" }],
  substances: [],
  intakes: [coffee, sugarBar, pizza],
};

const tr = simulate(day);

function lineAt(id: string, t: number, trajectory = tr): Process {
  const found = processesAt(trajectory, t).find((p) => p.id === id);
  if (!found) throw new Error(`Missing process ${id}`);
  return found;
}

function stopOf(process: Process, id: string): ProcessStop {
  const found = process.stops.find((s) => s.id === id);
  if (!found) throw new Error(`Missing stop ${id} in ${process.id}`);
  return found;
}

const readings = (process: Process) => Object.fromEntries(process.stops.map((s) => [s.label, s.reading]));
const shareSum = (process: Process) => process.stops.reduce((sum, s) => sum + s.share, 0);
const words = (text: string) => text.trim().split(/\s+/).length;

// These keep going all at once, so no stop on them is ever behind you.
const LIVE_LINES = ["insulin", "circulation", "alertness", "clearing"];

const SCENARIOS: Record<string, Scenario> = {
  "the test day": day,
  "nothing logged": { ...day, intakes: [] },
  "water only": { ...day, intakes: [{ ...NO_NUTRIENTS, id: "water", label: "Water", at: hm(9), grams: 500, waterMl: 500, liquid: true }] },
  "pure spirit": { ...day, intakes: [vodka] },
  "two rounds": { ...day, intakes: [beer, { ...beer, id: "beer_2", at: hm(19, 30) }, pizza] },
  "a latte and a pill": { ...day, intakes: [latte], substances: [ibuprofen] },
  "a walk": { ...day, activities: [{ from: hm(8), posture: "sitting" }, { from: hm(17), posture: "walking" }, { from: hm(18), posture: "sitting" }] },
};

describe("the lines at 17:00", () => {
  it("lists one line per logged thing, plus how the body works", () => {
    // Processes Claude has added come on top, and are checked by their own contract.
    const built = processesAt(tr, hm(17)).map((p) => p.id).filter((id) => !id.startsWith("ext:"));
    expect(built.sort()).toEqual(["alertness", "circulation", "clearing", "fat-route", "insulin", "intake:coffee", "meal:sugar_bar"].sort());
  });

  it("files each line under its system", () => {
    const systems = Object.fromEntries(processesAt(tr, hm(17)).map((p) => [p.id, p.system]));
    expect(systems["meal:sugar_bar"]).toBe("digestion");
    expect(systems["intake:coffee"]).toBe("brain");
    expect(systems.insulin).toBe("energy");
    expect(systems["fat-route"]).toBe("energy");
    expect(systems.circulation).toBe("circulation");
    expect(systems.alertness).toBe("brain");
    expect(systems.clearing).toBe("clearing");
  });

  it("follows the sugar bar and pizza as one meal", () => {
    const meal = lineAt("meal:sugar_bar", hm(17));
    expect(readings(meal)).toMatchObject({ Stomach: "100%", "Small intestine": "", Liver: "", Muscle: "", Fat: "" });
    expect(meal.headline).toBe("100% still in your stomach, just eaten");
    expect(meal.substance).toBe("chyme");
    expect(meal.title).toBe("Ate sugar bar and pizza");
    expect(meal.active).toBe(true);
    expect(stopOf(meal, "stomach").state).toBe("here");
    expect(lineAt("meal:sugar_bar", hm(17, 30)).headline).toMatch(/^\d+% still in your stomach, only the first sugar has reached your blood$/);
  });

  it("shows the coffee at work in your blood", () => {
    const line = lineAt("intake:coffee", hm(17));
    expect(readings(line)).toMatchObject({ Blood: "32%", Brain: "4% blocked" });
    expect(line.title).toBe("Drank coffee");
    expect(line.headline).toBe("32% still in your blood, 4% of the tired signal blocked");
    expect(line.substance).toBe("caffeine");
    expect(stopOf(line, "blood").state).toBe("here");
    expect(stopOf(line, "brain").say).toContain("4 of every 100");
    expect(stopOf(line, "stomach").reading).toBe("");
  });

  it("shows no value on a stop with nothing there", () => {
    const quiet = simulate({ ...day, intakes: [] });
    const line = lineAt("alertness", hm(12), quiet);
    expect(stopOf(line, "caffeine").reading).toBe("");
    expect(stopOf(line, "receptors").reading).toBe("");
    expect(stopOf(lineAt("insulin", hm(12), quiet), "muscle").reading).toBe("");
    for (const p of processesAt(tr, hm(17))) for (const s of p.stops) expect(s.reading, `${p.id} ${s.label}`).not.toMatch(/^0(\.0+)?( |%|$)/);
  });

  it("explains why sugar comes back down, with live numbers", () => {
    const line = lineAt("insulin", hm(18, 15));
    expect(line.stops.map((s) => s.label)).toEqual(["Blood sugar", "Pancreas", "Liver", "Muscle", "Fat tissue"]);
    expect(stopOf(line, "sugar").reading).toMatch(/^6\.\d mmol\/L$/);
    expect(stopOf(line, "pancreas").reading).toMatch(/^[45]\.\d×$/);
    expect(line.active).toBe(true);
    expect(line.headline).toContain("bringing sugar down");
    const destinations = ["liver", "muscle", "fat"].reduce((sum, id) => sum + stopOf(line, id).share, 0);
    expect(destinations).toBeCloseTo(1, 5);
  });

  it("explains why fat arrives later", () => {
    const line = lineAt("fat-route", hm(17));
    expect(line.stops.map((s) => s.label)).toEqual(["Small intestine", "Lymph", "Blood", "Fat tissue"]);
    expect(line.substance).toBe("fat");
    expect(stopOf(line, "intestine").state).toBe("here");
    expect(stopOf(line, "lymph").routes).toEqual(["lymph"]);
    expect(line.headline).toContain("still in your stomach");
    expect(lineAt("fat-route", hm(20, 16)).headline).toContain("in your blood");
  });

  it("splits the heart's output, with share of blood as the amount", () => {
    const line = lineAt("circulation", hm(17));
    expect(line.active).toBe(true);
    expect(line.headline).toMatch(/^3\d% of your blood is going to your gut, up from 25% at rest$/);
    expect(lineAt("circulation", hm(18)).headline).toMatch(/^3\d% of your blood is going to your gut, up from 25% at rest$/);
    for (const id of ["gut", "muscle", "brain", "kidneys"]) expect(stopOf(line, id).from).toBe("heart");
    expect(stopOf(line, "gut").share).toBeCloseTo(value(tr, "flowGut", hm(17)), 5);
    expect(stopOf(line, "gut").state).toBe("here");
    const branches = ["gut", "muscle", "brain", "kidneys"].reduce((sum, id) => sum + stopOf(line, id).share, 0);
    expect(branches).toBeGreaterThan(0.7);
    expect(branches).toBeLessThan(1);
  });

  it("links caffeine, receptors, alertness and sleep pressure", () => {
    const line = lineAt("alertness", hm(17));
    expect(line.stops.map((s) => s.label)).toEqual(["Caffeine in blood", "Tired signal blocked", "Alertness", "Sleep pressure"]);
    expect(stopOf(line, "receptors").reading).toBe("4%");
    expect(stopOf(line, "pressure").reading).toBe("9 hours awake");
    expect(stopOf(line, "alertness").say).toContain("the meal and time awake");
    expect(lineAt("alertness", hm(12)).stops.find((s) => s.id === "alertness")?.say).not.toContain("meal");
  });

  it("follows clearing from liver to bladder", () => {
    const line = lineAt("clearing", hm(17));
    expect(line.stops.map((s) => s.label)).toEqual(["Liver", "Kidneys", "Bladder"]);
    expect(stopOf(line, "liver").reading).toBe("4.3 mg/h");
    expect(stopOf(line, "bladder").routes).toEqual(["to_bladder_L", "to_bladder_R"]);
  });

  it("gives Claude the ids, titles and headlines to pick from", () => {
    const listed = readout(tr, hm(17)).processes;
    expect(listed.map((p) => p.id)).toContain("meal:sugar_bar");
    expect(listed.find((p) => p.id === "meal:sugar_bar")).toMatchObject({ title: "Ate sugar bar and pizza", system: "digestion", active: true });
    expect(listed.find((p) => p.id === "meal:sugar_bar")?.headline).toContain("still in your stomach");
  });

  it("filters by system, showing everything on the overview", () => {
    expect(processesFor(tr, hm(17), "brain").map((p) => p.id).sort()).toEqual(["alertness", "intake:coffee"]);
    expect(processesFor(tr, hm(17), "overview")).toHaveLength(processesAt(tr, hm(17)).length);
  });
});

describe("shares on a line", () => {
  it("add up to the whole food at every minute after it is eaten", () => {
    for (let t = pizza.at; t <= hm(26); t += 7) {
      expect(shareSum(lineAt("meal:sugar_bar", t))).toBeCloseTo(1, 4);
    }
  });

  it("add up to the whole dose of caffeine", () => {
    for (let t = coffee.at; t <= hm(26); t += 7) expect(shareSum(lineAt("intake:coffee", t))).toBeCloseTo(1, 3);
  });

  it("match the conserved ledger", () => {
    const t = hm(19);
    const a = ledgerAt(tr, "pizza", t);
    const b = ledgerAt(tr, "sugar_bar", t);
    const line = lineAt("meal:sugar_bar", t);
    if (!a || !b) throw new Error("No ledger");
    const total = [...Object.values(a), ...Object.values(b)].reduce((x, y) => x + y, 0);
    expect(stopOf(line, "stomach").share).toBeCloseTo((a.stomach + b.stomach) / total, 5);
    expect(stopOf(line, "fat").share).toBeCloseTo((a.fat + b.fat) / total, 5);
    const c = caffeineLedgerAt(tr, "coffee", t);
    if (!c) throw new Error("No caffeine ledger");
    expect(stopOf(lineAt("intake:coffee", t), "blood").share).toBeCloseTo(c.blood / c.dose, 5);
  });

  it("are all zero before anything is eaten", () => {
    const line = lineAt("meal:sugar_bar", hm(12));
    expect(shareSum(line)).toBe(0);
    expect(line.active).toBe(false);
    expect(line.headline).toBe("Logged for 16:45");
    expect(line.stops.every((s) => s.state === "ahead")).toBe(true);
  });

  it("split receptors between drinks so they add up to the total blocked", () => {
    const two = simulate({ ...day, intakes: [coffee, { ...coffee, id: "coffee_2", at: hm(10) }] });
    const t = hm(11);
    const blocked = (id: string) => parseFloat(stopOf(lineAt(id, t, two), "brain").reading);
    expect(blocked("intake:coffee") + blocked("intake:coffee_2")).toBeCloseTo(value(two, "occupancy", t) * 100, -0.5);
  });
});

describe("a sitting", () => {
  const bar: Intake = { ...sugarBar, at: hm(12) };
  const main: Intake = { ...pizza, at: hm(12, 10) };

  it("merges what you ate within 10 minutes into one line, summing its ledgers", () => {
    const lunch = simulate({ ...day, intakes: [bar, main] });
    const ids = processesAt(lunch, hm(13)).map((p) => p.id);
    expect(ids).toContain("meal:sugar_bar");
    expect(ids).not.toContain("intake:sugar_bar");
    expect(ids).not.toContain("intake:pizza");
    expect(lineAt("meal:sugar_bar", hm(13), lunch).title).toBe("Ate sugar bar and pizza");
    for (let t = main.at; t <= hm(20); t += 13) expect(shareSum(lineAt("meal:sugar_bar", t, lunch))).toBeCloseTo(1, 4);
  });

  it("keeps food eaten further apart as two lines", () => {
    const apart = simulate({ ...day, intakes: [bar, { ...main, at: hm(12, 11) }] });
    const ids = processesAt(apart, hm(13)).map((p) => p.id);
    expect(ids).toContain("intake:sugar_bar");
    expect(ids).toContain("intake:pizza");
    expect(lineAt("intake:pizza", hm(13), apart).title).toBe("Ate pizza");
  });
});

describe("where the action is", () => {
  it("walks the pizza down the line as the day goes on", () => {
    const hereOf = (t: number) => lineAt("meal:sugar_bar", t).stops.find((s) => s.state === "here")?.id;
    expect(hereOf(hm(16, 45))).toBe("stomach");
    expect(hereOf(hm(20))).toBe("stomach");
    expect(hereOf(hm(23))).toBe("intestine");
    expect(hereOf(hm(29))).toBeUndefined();
  });

  it("finishes every stop and says where the food went", () => {
    const done = lineAt("meal:sugar_bar", hm(29));
    expect(done.active).toBe(false);
    expect(done.stops.every((s) => s.state === "passed")).toBe(true);
    expect(done.headline).toMatch(/^Digested\. \d+% stored as fat/);
    expect(done.stops.every((s) => s.reading === "")).toBe(true);
  });

  it("moves muscle to the front of the blood when walking", () => {
    const walking = simulate(SCENARIOS["a walk"]);
    expect(stopOf(lineAt("circulation", hm(17, 30), walking), "muscle").state).toBe("here");
  });

  it("leaves insulin at rest when muscle is pulling sugar in by moving", () => {
    const fasted = simulate({ ...day, intakes: [], activities: [{ from: hm(8), posture: "sitting" }, { from: hm(12), posture: "walking" }] });
    const line = lineAt("insulin", hm(12, 20), fasted);
    expect(line.active).toBe(false);
    expect(stopOf(line, "muscle").say).toContain("Moving muscles");
  });

  it("rests the insulin and fat lines when nothing is happening", () => {
    const quietDay = simulate({ ...day, intakes: [] });
    const insulin = lineAt("insulin", hm(12), quietDay);
    expect(insulin.active).toBe(false);
    expect(insulin.headline).toBe("Insulin is at rest. Your liver keeps your blood sugar steady");
    expect(insulin.stops.every((s) => s.state === "ahead")).toBe(true);
    expect(lineAt("fat-route", hm(12), quietDay).headline).toBe("No fat eaten yet");
    expect(lineAt("alertness", hm(12), quietDay).active).toBe(false);
    expect(lineAt("circulation", hm(12), quietDay).headline).toContain("usual way");
  });

  it("stops talking about a coming rise on a resting insulin line", () => {
    expect(stopOf(lineAt("insulin", hm(12)), "sugar").say).not.toContain("heading for");
  });
});

describe("special lines", () => {
  it("gives even a small snack a food line, and coffee with a splash of milk none", () => {
    const small = simulate({ ...day, intakes: [{ ...NO_NUTRIENTS, id: "mint", label: "Mint", at: hm(9), grams: 5, carbsG: 4 }, { ...coffee, carbsG: 1, fatG: 1 }] });
    const ids = processesAt(small, hm(9, 30)).map((p) => p.id);
    expect(ids).toContain("intake:mint");
    expect(lineAt("intake:coffee", hm(9, 30), small).system).toBe("brain");
    expect(ids).not.toContain("caffeine:coffee");
  });

  it("gives a pure spirit an alcohol line and no food line", () => {
    const night = simulate(SCENARIOS["pure spirit"]);
    const ids = processesAt(night, hm(20, 30)).map((p) => p.id);
    expect(ids).toContain("alcohol:vodka");
    expect(ids).not.toContain("intake:vodka");
    const line = lineAt("alcohol:vodka", hm(20, 30), night);
    expect(line.substance).toBe("alcohol");
    expect(line.system).toBe("clearing");
    expect(line.active).toBe(true);
    expect(shareSum(line)).toBeCloseTo(1, 3);
  });

  it("splits the alcohol between drinks and conserves each one", () => {
    const night = simulate(SCENARIOS["two rounds"]);
    for (const t of [hm(19, 40), hm(21), hm(23)]) {
      expect(shareSum(lineAt("alcohol:beer", t, night))).toBeCloseTo(1, 3);
      expect(shareSum(lineAt("alcohol:beer_2", t, night))).toBeCloseTo(1, 3);
    }
    expect(lineAt("intake:beer", hm(20), night).title).toBe("Drank beer");
    expect(lineAt("alcohol:beer", hm(20), night).title).toBe("Alcohol in the beer");
  });

  it("follows a milky coffee through digestion and the brain separately", () => {
    const morning = simulate(SCENARIOS["a latte and a pill"]);
    expect(lineAt("intake:latte", hm(9, 30), morning).system).toBe("digestion");
    const caffeine = lineAt("caffeine:latte", hm(9, 30), morning);
    expect(caffeine.system).toBe("brain");
    expect(caffeine.title).toBe("Caffeine in the latte");
    expect(shareSum(caffeine)).toBeCloseTo(1, 3);
  });

  it("gives a custom substance a line through its target organ", () => {
    const morning = simulate(SCENARIOS["a latte and a pill"]);
    const pill = lineAt("substance:ibuprofen", hm(14), morning);
    expect(pill.system).toBe("brain");
    expect(pill.substance).toBe("other");
    expect(pill.title).toBe("Took ibuprofen");
    expect(pill.active).toBe(true);
    expect(pill.stops.map((s) => s.label)).toEqual(["Small intestine", "Blood", "Brain", "Cleared"]);
    expect(stopOf(pill, "target-0").say).toBe("Blocks the signal that makes pain.");
    expect(shareSum(pill)).toBeCloseTo(1, 3);
    expect(lineAt("substance:ibuprofen", hm(12), morning).headline).toBe("Logged for 13:00");
    expect(lineAt("substance:ibuprofen", hm(29), morning).active).toBe(false);
  });
});

describe("every minute of every kind of day", () => {
  const minutes: number[] = [];
  for (let t = hm(6); t <= hm(26); t++) minutes.push(t);

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const trajectory = simulate(scenario);
    const all = minutes.map((t) => ({ t, list: processesAt(trajectory, t) }));

    it(`writes no broken strings or numbers: ${name}`, () => {
      for (const { list } of all) {
        for (const p of list) {
          expect(`${p.title} ${p.headline}`).not.toMatch(/NaN|undefined|Infinity|null/);
          for (const s of p.stops) {
            expect(`${s.label} ${s.reading} ${s.say}`).not.toMatch(/NaN|undefined|Infinity|null/);
            expect(s.say).not.toBe("");
            expect(Number.isFinite(s.share)).toBe(true);
            expect(Number.isFinite(s.flow)).toBe(true);
            expect(s.share).toBeGreaterThanOrEqual(0);
            expect(s.share).toBeLessThanOrEqual(1);
            expect(s.flow).toBeGreaterThanOrEqual(0);
            expect(s.flow).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it(`keeps each line well formed: ${name}`, () => {
      for (const { list } of all) {
        for (const p of list) {
          const here = p.stops.filter((s) => s.state === "here");
          expect(here.length, `${p.id} active=${p.active}`).toBe(p.active ? 1 : 0);
          const order = p.stops.map((s) => s.state);
          if (LIVE_LINES.includes(p.id) || p.id.startsWith("ext:")) {
            expect(order, `${p.id} is live, so nothing is behind you`).not.toContain("passed");
          } else if (here.length) {
            const at = order.indexOf("here");
            expect(order.slice(0, at).every((s) => s === "passed"), `${p.id}: ${order.join(",")}`).toBe(true);
            expect(order.slice(at + 1).every((s) => s === "ahead"), `${p.id}: ${order.join(",")}`).toBe(true);
          }
          for (const s of p.stops) if (s.state === "passed") expect(s.reading, `${p.id} ${s.label}`).toBe("");
          p.stops.forEach((s, i) => {
            expect(s.number).toBe(i + 1);
            if (s.from !== null) expect(p.stops.slice(0, i).map((x) => x.id)).toContain(s.from);
          });
          expect(new Set(p.stops.map((s) => s.id)).size).toBe(p.stops.length);
        }
      }
    });

    it(`keeps the copy short and plain: ${name}`, () => {
      for (const { list } of all) {
        for (const p of list) {
          for (const s of p.stops) {
            expect(words(s.say), s.say).toBeLessThanOrEqual(25);
            expect(s.say).not.toMatch(/\bnot just\b|\brather than\b|\bbut not\b|\bnot only\b/i);
          }
          expect(p.headline).not.toMatch(/\bnot just\b|\brather than\b|\bbut not\b|\bnot only\b/i);
          expect(words(p.headline), p.headline).toBeLessThanOrEqual(18);
        }
      }
    });
  }
});

it("handles a fractional minute and the ends of the day", () => {
  for (const t of [0, 0.5, 1020.4, 1800]) {
    for (const p of processesAt(tr, t)) {
      expect(p.headline).not.toMatch(/NaN|undefined/);
      for (const s of p.stops) expect(s.say).not.toMatch(/NaN|undefined/);
    }
  }
});

describe("the liver clearing alcohol", () => {
  it("draws a line as thick as the grams it clears", () => {
    const beers = { ...NO_NUTRIENTS, id: "beers", label: "Three beers", at: hm(19), grams: 1500, waterMl: 1380, carbsG: 54, alcoholG: 60, liquid: true };
    const tr = simulate({ body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 }, intakes: [beers], activities: [{ from: 0, posture: "sleeping" }, { from: hm(7), posture: "sitting" }], substances: [], events: [] });
    const liver = processesAt(tr, hm(21)).find((p) => p.id === "clearing")?.stops.find((stop) => stop.label === "Liver");
    expect(liver?.flow).toBeGreaterThan(0.2);
  });
});
