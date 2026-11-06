import { describe, expect, it } from "vitest";
import { ACTION_SCHEMAS } from "../actions/schemas";
import type { BodyEvent } from "../model/events/types";
import type { Trajectory } from "../model/engine/trajectory";
import type { OrganId } from "../model/ids";
import { AS_THE_MODEL_SAYS, levelsAt, litLevels, panelsOf } from "./define";
import { simulate } from "../model/engine/simulate";
import { SCENARIOS } from "../model/testScenarios";
import { closeupGuidance, closeupOf, type CloseupStep, readsLikeYourDay, stepUsesDrawing } from "./list";
import { muscleCloseup } from "./muscle";

const session = {
  id: "squats",
  label: "Squats",
  preset: "training",
  from: 600,
  until: 660,
  intensity: 0.9,
  muscles: [{ group: "quads", load: 1 }],
  symptoms: [],
  source: "",
  custom: null,
} as unknown as BodyEvent;
const place = { trajectory: { muscleEvents: [session] } as unknown as Trajectory, muscle: "quads" as const };
const { keys, fromModel } = muscleCloseup;
const modelAt = (minute: number) => fromModel(place, minute);

describe("the muscle close-up, from the model", () => {
  it("is quiet before the session and with no muscle in view", () => {
    expect(Object.values(modelAt(500)).every((level) => level === 0)).toBe(true);
    expect(Object.values(fromModel({ ...place, muscle: null }, 640)).every((level) => level === 0)).toBe(true);
  });

  it("works hard during the session, with tears and little pain yet", () => {
    const during = modelAt(650);
    expect(during.work).toBeGreaterThan(0.3);
    expect(during.tears).toBeGreaterThan(0);
    expect(during.pain).toBeLessThan(during.tears);
  });

  it("hurts most a day or two later, and is rebuilt days after that", () => {
    const oneDay = modelAt(660 + 30 * 60);
    expect(oneDay.work).toBe(0);
    expect(oneDay.pain).toBeGreaterThan(modelAt(670).pain);
    expect(modelAt(660 + 6 * 1440).pain).toBeLessThan(oneDay.pain);
    expect(modelAt(660 + 6 * 1440).rebuilt).toBeGreaterThan(oneDay.rebuilt);
  });
});

describe("what a step can change", () => {
  const minute = 660 + 30 * 60;
  it("leaves the model's levels alone unless asked", () => {
    expect(levelsAt(keys, fromModel, place, minute, AS_THE_MODEL_SAYS)).toEqual(modelAt(minute));
  });

  it("sets the levels it names, scales others, and stays between 0 and 1", () => {
    const levels = levelsAt(keys, fromModel, place, minute, {
      light: null,
      set: { immune: 0.7 },
      times: { pain: 0.5, immune: 3 },
    });
    expect(levels.immune).toBe(1);
    expect(levels.pain).toBeCloseTo(modelAt(minute).pain * 0.5);
    expect(levels.tears).toBe(modelAt(minute).tears);
  });

  it("lights everything until a step singles something out", () => {
    expect(litLevels(keys, null).pain).toBe(1);
    const lit = litLevels(keys, ["pain"]);
    expect(lit.pain).toBe(1);
    expect(lit.immune).toBe(0);
  });

  it("draws one panel, or two to compare with only the lower one scaled", () => {
    expect(panelsOf<(typeof keys)[number]>(null)).toEqual([{ label: null, adjustment: AS_THE_MODEL_SAYS }]);
    const [upper, lower] = panelsOf<(typeof keys)[number]>({
      light: ["tears"],
      set: {},
      compare: { this_label: "First", other_label: "Repeat", times: { tears: 0.4 } },
    });
    expect(upper).toMatchObject({ label: "First", adjustment: { times: {} } });
    expect(lower).toMatchObject({ label: "Repeat", adjustment: { times: { tears: 0.4 } } });
  });
});

describe("what Claude can ask for", () => {
  const step = (closeup: unknown, organ: string | null = "muscle") => ({
    title: "Tiny tears",
    say: "Lowering the weight strains the fibres.",
    system: null,
    process: null,
    organ,
    muscle: "quads",
    at: -1770,
    closeup,
  });
  const parse = (closeup: unknown, organ?: string | null) =>
    ACTION_SCHEMAS.guide.safeParse({ steps: [step(closeup, organ)] });
  const directed = { organ: "muscle", light: ["tears"], set: {}, compare: null, basis: null };

  it("accepts a step that only points at something, days away from the chart", () => {
    expect(parse(directed).success).toBe(true);
  });

  it("wants a step on an organ with a close-up to point at something", () => {
    expect(parse(null).success).toBe(false);
    expect(parse(null, "kidneys").success).toBe(false);
    expect(parse({ organ: "kidneys", light: ["urine"], set: {}, compare: null, basis: null }, "kidneys").success).toBe(
      true,
    );
  });

  it("needs no close-up on a step with no organ", () => {
    expect(parse(null, null).success).toBe(true);
  });

  it("refuses a level the drawing doesn't have", () => {
    expect(parse({ ...directed, light: ["sparkle"] }).success).toBe(false);
  });

  it("lets a step point at nothing when no level means what it says", () => {
    expect(parse({ ...directed, light: [] }).success).toBe(true);
  });

  it("takes a composed drawing in place of a close-up, beside an organ", () => {
    const composed = {
      caption: "Smoke in an air sac",
      layers: [{ id: "air", kind: "air", label: "Air sac", state: "healthy", amount: 0 }],
      actors: [],
      light: [],
      basis: "Benowitz 2009",
    };
    const steps = (over: object) => ACTION_SCHEMAS.guide.safeParse({ steps: [{ ...step(null), ...over }] });
    expect(steps({ composed }).success).toBe(true);
    expect(steps({ composed, organ: null, muscle: null }).success).toBe(false);
  });

  it("wants a basis for any number of its own", () => {
    expect(parse({ ...directed, set: { immune: 0.7 } }).success).toBe(false);
    expect(
      parse({ ...directed, set: { immune: 0.7 }, basis: "Peake 2017 on inflammation after exercise" }).success,
    ).toBe(true);
    expect(
      parse({ ...directed, compare: { this_label: "First", other_label: "Repeat", times: { tears: 0.4 } } }).success,
    ).toBe(false);
  });

  it("wants the close-up of the organ the step flies to", () => {
    expect(parse(directed, "heart").success).toBe(false);
  });

  it("tells Claude what each level means", () => {
    expect(closeupOf("muscle")?.keys).toContain("immune");
    expect(closeupOf("no_such_organ" as OrganId)).toBeNull();
    expect(closeupGuidance()).toContain("immune (How many immune cells");
  });
});

describe("a drawing while exploring", () => {
  const during = 21 * 60 + 10;
  const added = (name: keyof typeof SCENARIOS, onto: Partial<(typeof SCENARIOS)[keyof typeof SCENARIOS]>) => ({
    place: { trajectory: simulate(SCENARIOS[name]), muscle: null },
    yourDay: simulate({ ...SCENARIOS[name], ...onto }),
  });

  it("is about a question that moved it, and not about one that left it alone", () => {
    const { place, yourDay } = added("sex", { events: [] });
    expect(readsLikeYourDay("heart", place, yourDay, during)).toBe(false);
    expect(readsLikeYourDay("brain", place, yourDay, during)).toBe(true);
    expect(readsLikeYourDay("stomach", place, yourDay, during)).toBe(true);
  });

  it("keeps the brain's caffeine when the question is the coffee", () => {
    const { place, yourDay } = added("far too much coffee", { intakes: [] });
    expect(readsLikeYourDay("brain", place, yourDay, 12 * 60)).toBe(false);
  });

  it("stays when a step points at something in it", () => {
    const step = (changes: Partial<CloseupStep>) =>
      ({ organ: "brain", light: [], set: {}, compare: null, basis: null, ...changes }) as CloseupStep;
    expect(stepUsesDrawing(step({ light: ["caffeine"] }), "brain")).toBe(true);
    expect(stepUsesDrawing(step({ set: { tired: 0.5 } }), "brain")).toBe(true);
    expect(stepUsesDrawing(step({}), "brain")).toBe(false);
    expect(stepUsesDrawing(step({ light: ["caffeine"] }), "heart")).toBe(false);
    expect(stepUsesDrawing(null, "brain")).toBe(false);
  });
});
