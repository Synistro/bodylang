import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hm, NO_NUTRIENTS } from "../model/testKit";
import { reduce } from "./reduce";
import { ACTION_SCHEMAS } from "./schemas";
import { stateWith } from "./testState";
import { traceLine } from "./trace";

describe("the tools", () => {
  const state = stateWith();
  const args = { id: "cold", label: "Cold", preset: "illness", from: hm(8), until: null, intensity: 0.4, muscles: [], symptoms: ["cough"], source: "", custom: null };

  it("passes a food's fructose share through, and leaves fibre out of the energy it traces", () => {
    const apples = { id: "apples", label: "Two apples", at: hm(9), grams: 364, water_ml: 310, carbs_g: 50, sugar_g: 38, fat_g: 0, protein_g: 0, fiber_g: 9, caffeine_mg: 0, alcohol_g: 0, liquid: false, fructose_share: 0.6, assumption: "Two medium apples" };
    const parsed = ACTION_SCHEMAS.log_intake.parse(apples);
    expect(reduce(state, { name: "log_intake", args: parsed }).day.intakes[0].fructoseShare).toBe(0.6);
    expect(traceLine({ name: "log_intake", args: parsed })).toContain("164 kcal");
    const { fructose_share: _unused, ...plainFood } = apples;
    expect(reduce(state, { name: "log_intake", args: ACTION_SCHEMAS.log_intake.parse(plainFood) }).day.intakes[0].fructoseShare).toBeUndefined();
  });

  it("hides a line when the food it follows is removed", () => {
    const showing = stateWith({ intakes: [{ ...NO_NUTRIENTS, id: "bar", label: "Bar", at: hm(16), grams: 50, carbsG: 30 }] }, { process: "meal:bar" });
    expect(reduce(showing, { name: "remove_intake", args: { id: "bar" } }).view.process).toBeNull();
  });

  it("logs and ends an event through the reducer", () => {
    const logged = reduce(state, { name: "log_event", args: ACTION_SCHEMAS.log_event.parse(args) });
    expect(logged.day.events).toHaveLength(1);
    expect(logged.day.events[0]).toMatchObject({ id: "cold", until: null, symptoms: ["cough"] });
    const ended = reduce(logged, { name: "end_event", args: ACTION_SCHEMAS.end_event.parse({ id: "cold", at: hm(13) }) });
    expect(ended.day.events[0].until).toBe(hm(13));
    const replaced = reduce(logged, { name: "log_event", args: ACTION_SCHEMAS.log_event.parse({ ...args, intensity: 0.9 }) });
    expect(replaced.day.events).toHaveLength(1);
    expect(replaced.day.events[0].intensity).toBe(0.9);
  });

  it("stores and traces the clinical label, whatever Claude typed", () => {
    const typed = ACTION_SCHEMAS.log_event.parse({ ...args, id: "s", label: "Hot night", preset: "sex", symptoms: [] });
    expect(reduce(state, { name: "log_event", args: typed }).day.events[0].label).toBe("Sexual activity");
    expect(traceLine({ name: "log_event", args: typed })).not.toContain("Hot");
  });

  it("tells Claude which ids exist when one is wrong", () => {
    expect(() => reduce(state, { name: "end_event", args: { id: "nope", at: 10 } })).toThrow(/Known ids: none/);
  });

  it("validates per preset, naming what to fix", () => {
    const parse = (patch: object) => ACTION_SCHEMAS.log_event.safeParse({ ...args, ...patch });
    expect(parse({}).success).toBe(true);
    expect(parse({ preset: "training", symptoms: [] }).success).toBe(false);
    expect(parse({ preset: "training", symptoms: [], muscles: [{ group: "chest", load: 1 }] }).success).toBe(true);
    expect(parse({ preset: "stress" }).success).toBe(false);
    expect(parse({ from: hm(9), until: hm(8) }).success).toBe(false);
    expect(parse({ preset: "custom", symptoms: [] }).success).toBe(false);
    expect(parse({ custom: { systems: ["immune"], effects: [], feelings: [], stops: [] } }).success).toBe(false);
    const failed = parse({ preset: "training", symptoms: [] });
    if (failed.success) throw new Error("Should have failed");
    expect(failed.error.issues[0].path).toEqual(["muscles"]);
  });

  it("accepts days before today, and keeps a custom story's words short", () => {
    const story = { systems: ["circulation"], effects: [{ channel: "heartRate", amount: 40, rise_min: 10, half_life_min: 10 }], feelings: [], stops: [{ organ: "heart", muscle: null, label: "Skin", after_min: 0, say: "Blood moves to your skin.", routes: [] }] };
    expect(ACTION_SCHEMAS.log_event.safeParse({ ...args, from: -hm(48) }).success).toBe(true);
    expect(ACTION_SCHEMAS.log_event.safeParse({ ...args, preset: "custom", symptoms: [], custom: story }).success).toBe(true);
    const tooLong = { ...story, stops: [{ ...story.stops[0], say: "word ".repeat(26) }] };
    expect(ACTION_SCHEMAS.log_event.safeParse({ ...args, preset: "custom", symptoms: [], custom: tooLong }).success).toBe(false);
  });

  it("turns a custom story into the model's own shape", () => {
    const story = { systems: ["circulation"], effects: [{ channel: "heartRate", amount: 40, rise_min: 10, half_life_min: 10 }], feelings: [], stops: [{ organ: "heart", muscle: null, label: "Skin", after_min: 3, say: "Blood moves to your skin.", routes: ["arch"] }] };
    const logged = reduce(state, { name: "log_event", args: ACTION_SCHEMAS.log_event.parse({ ...args, preset: "custom", symptoms: [], custom: story }) });
    expect(logged.day.events[0].custom?.effects[0]).toMatchObject({ riseMin: 10, halfLifeMin: 10 });
    expect(logged.day.events[0].custom?.stops[0]).toMatchObject({ afterMin: 3, routes: ["arch"] });
  });

  it("traces events in one readable line, even from yesterday", () => {
    expect(traceLine({ name: "log_event", args: ACTION_SCHEMAS.log_event.parse({ ...args, from: -360 }) })).toBe("log_event Cold, illness, 18:00, ongoing");
    expect(traceLine({ name: "end_event", args: { id: "cold", at: hm(13) } })).toBe("end_event cold, 13:00");
  });

  it("hands the SDK schemas it can convert for Claude", () => {
    for (const schema of [ACTION_SCHEMAS.log_event, ACTION_SCHEMAS.end_event]) {
      const json = z.toJSONSchema(z.object(schema.shape));
      expect(JSON.stringify(json)).toContain("properties");
    }
    expect(Object.keys(ACTION_SCHEMAS.log_event.shape)).toEqual(["id", "label", "preset", "from", "until", "intensity", "muscles", "symptoms", "source", "custom"]);
  });
});

describe("selecting an organ", () => {
  const start = (system: "clearing" | "digestion" | "overview") => reduce(stateWith(), { name: "show_system", args: { system } });
  const focus = (state: ReturnType<typeof start>, organ: "lungs" | "liver") => reduce(state, { name: "focus_organ", args: { organ } });

  it("goes to the organ's own section when it is not in this one", () => {
    expect(focus(start("clearing"), "lungs").view.system).toBe("circulation");
  });

  it("stays when the organ belongs here, or when you came from the overview", () => {
    expect(focus(start("digestion"), "liver").view.system).toBe("digestion");
    expect(focus(start("overview"), "lungs").view.system).toBe("overview");
  });
});
