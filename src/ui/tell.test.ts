import { afterEach, describe, expect, it, vi } from "vitest";
import { getState, goToStep, leaveAsk, setMode } from "../store";
import { tell } from "./tell";

const streamOf = (...events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200 });
const latest = () => {
  const { exchanges } = getState();
  return exchanges[exchanges.length - 1];
};

afterEach(() => vi.unstubAllGlobals());

describe("what a message ends as", () => {
  it("keeps the real reason when Claude can't run", async () => {
    vi.stubGlobal("fetch", async () => streamOf({ type: "error", message: "Claude Code could not run: not logged in" }, { type: "done" }));
    await tell("hello");
    expect(latest().status).toBe("error");
    expect(latest().error).toBe("Claude Code could not run: not logged in");
  });

  it("keeps an answer already shown when a late failure follows", async () => {
    vi.stubGlobal("fetch", async () => streamOf({ type: "reply", lines: [{ text: "Your heart is steady." }] }, { type: "error", message: "Claude stopped early: error_max_turns." }, { type: "done" }));
    await tell("hello");
    expect(latest().status).toBe("done");
    expect(latest().reply[0].text).toBe("Your heart is steady.");
  });

  it("stops the server's work when a message can't be read", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return streamOf({ type: "action", name: "not_a_tool", args: {} });
    });
    await tell("hello");
    expect(latest().status).toBe("error");
    expect(signal?.aborted).toBe(true);
  });

  it("says so when the stream ends with no answer", async () => {
    vi.stubGlobal("fetch", async () => streamOf({ type: "done" }));
    await tell("hello");
    expect(latest().status).toBe("error");
    expect(latest().error).toMatch(/without an answer/);
  });
});

const burger = { id: "burger", label: "Burger", at: 1030, grams: 250, water_ml: 100, carbs_g: 40, sugar_g: 8, fat_g: 30, protein_g: 25, fiber_g: 2, caffeine_mg: 0, alcohol_g: 0, liquid: false, assumption: "One burger" };
const logBurger = { type: "action", name: "log_intake", args: burger };
const step = (over: object) => ({ title: "A step", say: "Something happens.", system: null, process: null, organ: null, muscle: null, at: null, closeup: null, ...over });

describe("asking never touches your day", () => {
  afterEach(() => setMode("tell"));

  it("runs on a copy, and leaving puts back the very same day", async () => {
    const before = getState();
    setMode("ask");
    vi.stubGlobal("fetch", async () => streamOf(logBurger, { type: "reply", lines: [{ text: "Sugar peaks higher." }] }, { type: "done" }));
    await tell("what if I eat a burger");
    expect(getState().day.intakes.map((i) => i.id)).toContain("burger");
    expect(getState().asking?.real.day).toBe(before.day);

    leaveAsk();
    expect(getState().day).toBe(before.day);
    expect(getState().trajectory).toBe(before.trajectory);
    expect(getState().t).toBe(before.t);
    expect(getState().asking).toBeNull();
  });

  it("drops whatever arrives after you left", async () => {
    const before = getState();
    setMode("ask");
    let deliver: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (deliver = resolve)));
    const answering = tell("what if I eat a burger");
    await Promise.resolve();
    leaveAsk();
    deliver(streamOf(logBurger, { type: "reply", lines: [{ text: "Too late." }] }, { type: "done" }));
    await answering;
    expect(getState().day).toBe(before.day);
    expect(latest().status).toBe("done");
    expect(latest().reply).toEqual([]);
  });

  it("sends a Tell from your real day, even in the middle of exploring", async () => {
    const before = getState();
    setMode("ask");
    vi.stubGlobal("fetch", async () => streamOf(logBurger, { type: "reply", lines: [{ text: "Higher." }] }, { type: "done" }));
    await tell("what if I eat a burger");
    setMode("tell");
    expect(getState().day).toBe(before.day);
    const sent: { mode: string; state: { day: { intakes: { id: string }[] } } }[] = [];
    vi.stubGlobal("fetch", async (_: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return streamOf({ type: "reply", lines: [{ text: "Logged." }] }, { type: "done" });
    });
    await tell("I had a walk");
    expect(sent[0].mode).toBe("tell");
    expect(sent[0].state.day.intakes.map((i) => i.id)).not.toContain("burger");
  });

  it("keeps follow-ups on the same copy and tells Claude what was said", async () => {
    setMode("ask");
    vi.stubGlobal("fetch", async () => streamOf(logBurger, { type: "reply", lines: [{ text: "Sugar peaks higher." }] }, { type: "done" }));
    await tell("what if I eat a burger");
    const sent: { history: { asked: string; answered: string }[]; state: { day: { intakes: { id: string }[] } } }[] = [];
    vi.stubGlobal("fetch", async (_: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return streamOf({ type: "reply", lines: [{ text: "Lower." }] }, { type: "done" });
    });
    await tell("and if I walk after");
    expect(sent[0].history).toEqual([{ asked: "what if I eat a burger", answered: "Sugar peaks higher." }]);
    expect(sent[0].state.day.intakes.map((i) => i.id)).toContain("burger");
  });

  it("walks through a guide, each step moving the view, and leaving restores it", async () => {
    const before = getState();
    setMode("ask");
    const steps = [step({ system: "energy", process: "insulin" }), step({ organ: "pancreas", at: 1100, closeup: { organ: "pancreas", light: ["insulin"], set: {}, compare: null, basis: null } })];
    vi.stubGlobal("fetch", async () => streamOf({ type: "action", name: "guide", args: { steps } }, { type: "reply", lines: [{ text: "Insulin moves sugar." }] }, { type: "done" }));
    await tell("explain insulin");
    expect(getState().view).toMatchObject({ system: "energy", process: "insulin", focus: null });
    expect(getState().asking?.guideOpen).toBe(true);
    goToStep(1);
    expect(getState().view).toMatchObject({ system: "energy", process: null, focus: "pancreas" });
    expect(getState().trajectory).toBe(before.trajectory);
    leaveAsk();
    expect(getState().day).toBe(before.day);
  });
});
