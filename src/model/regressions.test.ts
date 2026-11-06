import { describe, expect, it } from "vitest";
import { Action, BodyState, reduce } from "../actions/actions";
import { assess } from "./assess";
import { followProcess, processesAt } from "./processes";
import { simulate } from "./engine/simulate";
import { anthropometrics } from "./engine/anthropometrics";
import { Intake, postureAt, Scenario } from "./scenario";
import { threadsAt } from "./threads";

const BODY = { sex: "male", age: 30, heightCm: 180, weightKg: 80 } as const;
const DAYTIME = [
  { from: 0, posture: "sleeping" },
  { from: 450, posture: "sitting" },
] as Scenario["activities"];

const food = (id: string, at: number, parts: Partial<Intake> = {}): Intake => ({ id, label: id, at, grams: 100, waterMl: 50, carbsG: 30, sugarG: 5, fatG: 10, proteinG: 10, fiberG: 2, caffeineMg: 0, alcoholG: 0, liquid: false, ...parts });
const day = (parts: Partial<Scenario>): Scenario => ({ body: BODY, intakes: [], activities: DAYTIME, substances: [], events: [], ...parts });
const training = (id: string, from: number, until: number | null, group: "chest" | "back" | "quads") => ({ id, label: id, preset: "training" as const, from, until, intensity: 0.8, muscles: [{ group, load: 1 }], symptoms: [], custom: null, source: "" });

const start: BodyState = { body: BODY, intakes: [], activities: DAYTIME, substances: [], events: [], cycle: null, now: 1020, system: "overview", process: null, focus: null, focusMuscle: null, whatIf: null, assumptions: {} };
const apply = (state: BodyState, action: Action) => reduce(state, action);

describe("a meal with a drink in it", () => {
  it("keeps the food's thread when the meal includes alcohol", () => {
    const tr = simulate(day({ intakes: [food("pizza", 1000), food("beer", 1002, { liquid: true, carbsG: 13, sugarG: 0, fatG: 0, proteinG: 2, fiberG: 0, alcoholG: 14 })] }));
    const titles = threadsAt(tr, 1020).map((t) => t.title);
    expect(titles.some((t) => t.includes("pizza"))).toBe(true);
    expect(titles.some((t) => t.includes("beer"))).toBe(true);
  });
});

describe("a selected process whose id goes away", () => {
  it("follows a food into a meal and back out again", () => {
    const alone = simulate(day({ intakes: [food("pizza", 1000)] }));
    const together = simulate(day({ intakes: [food("pizza", 1000), food("coke", 1005, { liquid: true })] }));
    expect(followProcess(alone, "intake:pizza", 1020)).toBe("intake:pizza");
    expect(followProcess(together, "intake:pizza", 1020)).toBe("meal:pizza");
    expect(followProcess(alone, "meal:pizza", 1020)).toBe("intake:pizza");
  });

  it("lets go of anything that no longer exists", () => {
    const tr = simulate(day({ intakes: [food("pizza", 1000)] }));
    expect(followProcess(tr, "alcohol:beer", 1020)).toBeNull();
    expect(followProcess(tr, "intake:gone", 1020)).toBeNull();
    expect(followProcess(tr, "event:gone", 1020)).toBeNull();
  });

  it("never loses a process just because the time changed", () => {
    const tr = simulate(day({ intakes: [food("pizza", 1000), food("coffee", 510, { liquid: true, carbsG: 0, sugarG: 0, fatG: 0, proteinG: 0, fiberG: 0, caffeineMg: 95 })], events: [training("legs", 540, 600, "quads")] }));
    const ids = processesAt(tr, 1020).map((p) => p.id);
    for (let t = 0; t <= 1799; t += 30) expect(processesAt(tr, t).map((p) => p.id)).toEqual(ids);
  });
});

describe("what the muscle sentences name", () => {
  const sentence = (scenario: Scenario, t: number) => assess(simulate(scenario), t).systems.muscles.sentence;

  it("names only what is working now", () => {
    expect(sentence(day({ events: [training("legs", -1440, -1380, "quads"), training("chest", 1000, 1060, "chest")] }), 1030)).toBe("Your chest is working.");
  });

  it("leaves out a session that faded long ago", () => {
    expect(sentence(day({ events: [training("back", -20160, -20100, "back"), training("chest", 1000, 1060, "chest")] }), 1030)).toBe("Your chest is working.");
  });

  it("names a group once across two sessions", () => {
    const text = sentence(day({ events: [training("a", 480, 540, "chest"), training("b", 800, 860, "chest")] }), 1000);
    expect(text.match(/chest/g)).toHaveLength(1);
  });

  it("counts a session logged with no end", () => {
    const events = [training("open", 1000, null, "chest")];
    expect(sentence(day({ events }), 1030)).toBe("Your chest is working.");
    expect(sentence(day({ events }), 1700)).toMatch(/^Your chest is (repairing|sore)\. Soreness peaks/);
  });
});

describe("an event's end", () => {
  it("refuses a time before the event started", () => {
    const logged = apply(start, { name: "log_event", args: { id: "cold", label: "Cold", preset: "illness", from: 600, until: null, intensity: 0.5, muscles: [], symptoms: ["fever"], custom: null, source: "" } });
    expect(() => apply(logged, { name: "end_event", args: { id: "cold", at: 300 } })).toThrow(/can't end/);
    expect(apply(logged, { name: "end_event", args: { id: "cold", at: 700 } }).events[0].until).toBe(700);
  });
});

describe("a span that ends after bedtime", () => {
  it("ends in sleep", () => {
    const next = apply(start, { name: "set_activity", args: { posture: "walking", from: 1400, until: 1425 } });
    expect(postureAt(next.activities, 1420)).toBe("walking");
    expect(postureAt(next.activities, 1500)).toBe("sleeping");
  });

  it("returns to what you were doing before bedtime", () => {
    const next = apply(start, { name: "set_activity", args: { posture: "walking", from: 1000, until: 1015 } });
    expect(postureAt(next.activities, 1100)).toBe("sitting");
  });
});

describe("extreme inputs", () => {
  const dose = (tmaxMin: number, halfLifeH: number) => ({ id: "x", label: "X", at: 600, doseMg: 100, tmaxMin, halfLifeH, volumeLPerKg: 1, bioavailability: 1, targets: [], source: "" });

  it.each([
    [1, 2],
    [2, 2],
    [3, 2],
    [1, 0.001],
  ])("keeps a substance finite and never negative at Tmax %d min, half-life %d h", (tmax, halfLife) => {
    const series = simulate(day({ substances: [dose(tmax, halfLife)] })).substances.get("x")?.series;
    expect(series).toBeDefined();
    for (const v of series ?? []) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps lean mass under body weight", () => {
    expect(anthropometrics({ sex: "male", age: 30, heightCm: 200, weightKg: 45 }).leanKg).toBeLessThan(45);
  });
});
