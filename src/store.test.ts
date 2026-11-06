import { beforeEach, describe, expect, it } from "vitest";
import { reduce } from "./actions/actions";
import { firstDay } from "./model/day";
import { dayDocOf, dispatch, enterAsk, getState, leaveAsk, restoreDay, setClock, setUi } from "./store";

const body = { sex: "female", age: 41, heightCm: 170, weightKg: 62 } as const;
const coffee = { id: "coffee", label: "Coffee", at: 500, grams: 240, water_ml: 238, carbs_g: 0, sugar_g: 0, fat_g: 0, protein_g: 0, fiber_g: 0, caffeine_mg: 96, alcohol_g: 0, liquid: true, assumption: "One cup" };

describe("your day and the store", () => {
  beforeEach(() => {
    leaveAsk();
    restoreDay(firstDay("2026-11-05", body), 12 * 60);
    setUi({ t: 12 * 60, playing: false });
  });

  it("puts a saved day in place at the real time", () => {
    const s = getState();
    expect(s.date).toBe("2026-11-05");
    expect(s.body.now).toBe(12 * 60);
    expect(s.body.body).toEqual(body);
  });

  it("turns back into the same file", () => {
    dispatch({ name: "log_intake", args: coffee });
    const doc = dayDocOf(getState());
    expect(doc?.intakes.map((i) => i.id)).toEqual(["coffee"]);
    expect(doc?.assumptions.coffee).toBe("One cup");
    expect(doc?.date).toBe("2026-11-05");
  });

  it("moves a view resting on now along with the clock", () => {
    setClock(12 * 60 + 1);
    expect(getState().body.now).toBe(12 * 60 + 1);
    expect(getState().t).toBe(12 * 60 + 1);
  });

  it("leaves a view you scrubbed away where you put it", () => {
    setUi({ t: 9 * 60 });
    setClock(12 * 60 + 1);
    expect(getState().body.now).toBe(12 * 60 + 1);
    expect(getState().t).toBe(9 * 60);
  });

  it("recalculates nothing when only the clock moves", () => {
    const before = getState().trajectory;
    setClock(12 * 60 + 5);
    expect(getState().trajectory).toBe(before);
  });

  it("has nothing to save while you explore", () => {
    dispatch({ name: "log_intake", args: coffee });
    const saved = dayDocOf(getState());
    enterAsk();
    dispatch({ name: "log_intake", args: { ...coffee, id: "imagined" } });
    expect(dayDocOf(getState())).toBeNull();
    leaveAsk();
    const after = dayDocOf(getState());
    expect(after?.intakes).toBe(saved?.intakes);
    expect(after?.intakes.map((i) => i.id)).toEqual(["coffee"]);
  });
});

describe("selecting an organ", () => {
  const start = (system: "clearing" | "digestion" | "overview") => reduce(getState().body, { name: "show_system", args: { system } });
  const focus = (body: ReturnType<typeof start>, organ: "lungs" | "liver") => reduce(body, { name: "focus_organ", args: { organ } });

  it("goes to the organ's own section when it is not in this one", () => {
    expect(focus(start("clearing"), "lungs").system).toBe("circulation");
  });

  it("stays when the organ belongs here, or when you came from the overview", () => {
    expect(focus(start("digestion"), "liver").system).toBe("digestion");
    expect(focus(start("overview"), "lungs").system).toBe("overview");
  });
});
