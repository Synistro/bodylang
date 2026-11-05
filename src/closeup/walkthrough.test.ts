import { describe, expect, it } from "vitest";
import type { GuideStep } from "../agent/actions";
import { chartOffsetHours, closeGuide, closeupOnScreen, dispatch, enterAsk, getState, goToStep, leaveAsk, muscleMinute, releaseMoment, stepMinute } from "../store";

const step = (at: number | null): GuideStep => ({ title: "A step", say: "Something happens.", system: null, process: null, organ: "muscle", muscle: "quads", at, closeup: { organ: "muscle", light: ["tears"], set: {}, compare: null, basis: null } });

function walkthrough(...steps: GuideStep[]) {
  enterAsk();
  dispatch({ name: "guide", args: { steps } });
}

describe("a walkthrough step that shows a minute off the day chart", () => {
  it("moves what a muscle shows, and leaves the chart where it is", () => {
    const t = getState().t;
    walkthrough(step(-1770), step(null));
    expect(muscleMinute(getState())).toBe(-1770);
    expect(getState().t).toBe(t);
    expect(chartOffsetHours(getState())).toBe(Math.round((-1770 - t) / 60));
    expect(closeupOnScreen(getState())?.light).toEqual(["tears"]);
    leaveAsk();
  });

  it("keeps that moment on a step with no time of its own, and goes back to the chart on one that names today", () => {
    const onTheChart = 1000;
    walkthrough(step(-1770), step(null), step(onTheChart));
    goToStep(1);
    expect(muscleMinute(getState())).toBe(-1770);
    goToStep(2);
    expect(muscleMinute(getState())).toBe(getState().t);
    expect(chartOffsetHours(getState())).toBeNull();
    goToStep(1);
    expect(muscleMinute(getState())).toBe(-1770);
    leaveAsk();
  });

  it("gives every step one minute, whichever way you reached it", () => {
    const steps = [step(null), step(1000), step(null), step(-1770), step(null)];
    expect(steps.map((_, index) => stepMinute(steps, index))).toEqual([null, 1000, 1000, -1770, -1770]);
  });

  it("lets go when you touch the chart or close the walkthrough", () => {
    walkthrough(step(-1770));
    releaseMoment();
    expect(muscleMinute(getState())).toBe(getState().t);
    goToStep(0);
    expect(muscleMinute(getState())).toBe(-1770);
    closeGuide();
    expect(muscleMinute(getState())).toBe(getState().t);
    expect(closeupOnScreen(getState())).toBeNull();
    leaveAsk();
  });
});

describe("where a step puts an organ in the outline", () => {
  const onOrgan = (over: Partial<GuideStep>): GuideStep => ({ ...step(null), ...over });
  const place = () => {
    const { system, process, focus } = getState().body;
    return { system, process, focus };
  };

  it("keeps it in one place whatever each step names", () => {
    walkthrough(onOrgan({ system: "muscles", process: "event:squats" }), onOrgan({ system: "immune" }), onOrgan({}));
    const first = place();
    expect(first).toEqual({ system: "muscles", process: null, focus: "muscle" });
    goToStep(1);
    expect(place()).toEqual(first);
    goToStep(2);
    expect(place()).toEqual(first);
    leaveAsk();
  });

  it("goes to the organ's own section from the overview", () => {
    walkthrough(onOrgan({ organ: "heart", muscle: null, closeup: null }));
    expect(place()).toEqual({ system: "circulation", process: null, focus: "heart" });
    leaveAsk();
  });

  it("stays in the section you are in when the organ belongs there", () => {
    enterAsk();
    dispatch({ name: "show_system", args: { system: "energy" } });
    dispatch({ name: "guide", args: { steps: [onOrgan({})] } });
    expect(place()).toEqual({ system: "energy", process: null, focus: "muscle" });
    leaveAsk();
  });

  it("still draws a process line on a step with no organ", () => {
    enterAsk();
    const from = Math.round(getState().t) - 120;
    dispatch({ name: "log_event", args: { id: "squats", label: "Squats", preset: "training", from, until: from + 60, intensity: 0.8, muscles: [{ group: "quads", load: 1 }], symptoms: [], source: "", custom: null } });
    dispatch({ name: "guide", args: { steps: [onOrgan({ organ: null, muscle: null, closeup: null, system: "muscles", process: "event:squats" })] } });
    expect(place()).toEqual({ system: "muscles", process: "event:squats", focus: null });
    leaveAsk();
  });
});
