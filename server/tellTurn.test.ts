import { describe, expect, it } from "vitest";
import { Action, ACTION_SCHEMAS } from "../src/actions/schemas";
import { BodyState, reduce } from "../src/actions/reduce";
import type { TellEvent } from "../src/wire";
import { searchFoods } from "./foods";
import { actionToolsFor, planFor, systemPromptFor, TellPlan } from "./tellPrompt";
import { startTurn, TellInput } from "./tellTurn";

// A turn with no Claude in it: each test calls the tools the way Claude would, in the order it would.
const BRIEF = planFor("tell", "simple");
const FULL: TellPlan = { ...BRIEF, brief: false };

const start: BodyState = {
  body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 },
  activities: [{ from: 0, posture: "sleeping" }, { from: 450, posture: "standing" }],
  intakes: [],
  substances: [],
  events: [],
  cycle: null,
  now: 800,
  system: "overview",
  process: null,
  focus: null,
  focusMuscle: null,
  whatIf: null,
  assumptions: {},
};

const input = (over: Partial<TellInput> = {}): TellInput => ({ text: "I had some pizza", state: start, mode: "tell", depth: "simple", history: [], date: "2026-11-06", ...over });

function turnOf(over: Partial<TellInput> = {}, plan = BRIEF) {
  const events: TellEvent[] = [];
  const turn = startTurn(input(over), plan, (event) => events.push(event), () => undefined);
  const call = (name: string, args: unknown) => {
    const found = turn.tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`No tool ${name}`);
    return found.handler(args as never, {});
  };
  return { turn, events, call };
}

// What the page ends up with: the same reducer, fed only the actions that were sent.
const replayed = (events: TellEvent[], from: BodyState) =>
  events.reduce((state, event) => (event.type === "action" ? reduce(state, { name: event.name, args: ACTION_SCHEMAS[event.name as keyof typeof ACTION_SCHEMAS].parse(event.args) } as Action) : state), from);

const pizza = () => searchFoods("pizza cheese")[0];
const loggedPizza = () => ({ id: "pizza", label: "Pizza", at: 790, fdc_id: pizza().fdcId, serving_label: "slice", serving_grams: 107, servings: 2, liquid: false, assumption: "Two slices" });

describe("one turn", () => {
  it("leaves the page exactly where the server ended up", async () => {
    const { turn, events, call } = turnOf();
    await call("log_food", loggedPizza());
    await call("log_event", { id: "chest", label: "Chest", preset: "training", from: 600, until: 660, intensity: 0.6, muscles: [{ group: "chest", load: 1 }], symptoms: [], source: "", custom: null });
    await call("show_system", { system: "digestion" });
    expect(replayed(events, start)).toEqual(turn.state());
    expect(turn.state().intakes.map((intake) => intake.id)).toEqual(["pizza"]);
    expect(turn.state().system).toBe("digestion");
  });

  it("marks a food from the table as the table's, and Claude's own as an estimate", async () => {
    const { turn, call } = turnOf();
    await call("log_food", loggedPizza());
    await call("log_intake", { id: "soup", label: "Soup", at: 795, grams: 300, water_ml: 250, carbs_g: 10, sugar_g: 2, fat_g: 4, protein_g: 5, fiber_g: 1, caffeine_mg: 0, alcohol_g: 0, liquid: true, assumption: "A bowl" });
    const sources = Object.fromEntries(turn.state().intakes.map((intake) => [intake.id, intake.source?.kind]));
    expect(sources).toEqual({ pizza: "table", soup: "estimate" });
  });

  it("answers a mistake in words Claude can act on, and changes nothing", async () => {
    const { turn, events, call } = turnOf();
    const refused = await call("log_food", { ...loggedPizza(), fdc_id: -1 });
    expect(refused.isError).toBe(true);
    const unknown = await call("show_process", { id: "nothing" });
    expect(JSON.stringify(unknown)).toMatch(/Known ids/);
    expect(events).toEqual([]);
    expect(turn.state()).toBe(start);
  });

  it("keeps a brief turn's logging quiet, and a full one returns the numbers", async () => {
    const brief = await turnOf().call("show_system", { system: "brain" });
    expect(JSON.stringify(brief)).toContain("Recorded.");
    const full = await turnOf({}, FULL).call("show_system", { system: "brain" });
    expect(JSON.stringify(full)).toContain("glucose_mmol_l");
  });
});

describe("what gets checked in a reply", () => {
  it("marks a number the model never returned, and passes one it did", async () => {
    const { events, call } = turnOf();
    const answered = await call("read_body", { at: 800 });
    const first = answered.content[0];
    const said = JSON.parse(first.type === "text" ? first.text : "{}") as { blood: { glucose_mmol_l: number } };
    await call("reply", { lines: [{ text: `Sugar is ${said.blood.glucose_mmol_l}. Most people hit 97.5.` }] });
    expect(events.at(-1)).toMatchObject({ type: "reply", lines: [{ unverified: ["97.5"] }] });
  });

  it("sends back a line that is too long", async () => {
    const { turn, call } = turnOf();
    const refused = await call("reply", { lines: [{ text: Array.from({ length: 30 }, () => "word").join(" ") }] });
    expect(refused.isError).toBe(true);
    expect(turn.replied()).toBe(false);
  });

  it("asks once for the walkthrough in Ask, then lets a plain answer through", async () => {
    const { turn, call } = turnOf({ mode: "ask" });
    const first = await call("reply", { lines: [{ text: "Call emergency services now." }] });
    expect(first.isError).toBe(true);
    await call("reply", { lines: [{ text: "Call emergency services now." }] });
    expect(turn.replied()).toBe(true);
  });
});

describe("what each mode can reach", () => {
  const OWN_TOOLS = ["find_foods", "log_food", "log_dish", "add_process", "read_body", "reply"];
  const everyTool = [...Object.keys(ACTION_SCHEMAS), ...OWN_TOOLS];
  const namedIn = (prompt: string) => everyTool.filter((name) => new RegExp(`\\b${name}\\b`).test(prompt));

  it.each([["tell", "simple"], ["ask", "simple"], ["ask", "deep"]] as const)("the %s %s prompt names only tools it has", (mode, depth) => {
    const available = [...actionToolsFor(mode), ...OWN_TOOLS];
    const plan = planFor(mode, depth);
    expect(namedIn(systemPromptFor(mode, depth, plan)).filter((name) => !available.includes(name as never))).toEqual([]);
  });

  it("gives Claude no clock of its own", () => {
    expect(actionToolsFor("tell")).not.toContain("set_now");
    expect(actionToolsFor("ask")).not.toContain("set_now");
  });

  it("keeps the walkthrough to Ask and the alternative to Tell", () => {
    expect(actionToolsFor("tell")).toContain("what_if");
    expect(actionToolsFor("tell")).not.toContain("guide");
    expect(actionToolsFor("ask")).toContain("guide");
    expect(actionToolsFor("ask")).not.toContain("what_if");
  });
});
