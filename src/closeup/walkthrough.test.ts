import { describe, expect, it } from "vitest";
import type { GuideStep } from "../actions/actions";
import { chartOffsetHours, closeGuide, closeupOnScreen, composedOnScreen, dispatch, enterAsk, getState, goToStep, leaveAsk, muscleMinute, processOnScreen, releaseMoment, stepMinute, trackOnScreen } from "../store";

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

describe("what a step shows beside an organ", () => {
  const composed = { caption: "A torn vessel", layers: [{ id: "vessel", kind: "blood" as const, label: "Vessel", state: "torn" as const, amount: 0.8 }], actors: [], light: [], basis: "Trauma surgery textbooks" };

  it("keeps the process it is about out of the outline, and still knows it", () => {
    walkthrough({ ...step(null), process: "event:squats" });
    expect(getState().body.process).toBeNull();
    expect(processOnScreen(getState())).toBe("event:squats");
    leaveAsk();
  });

  it("has no process of its own to point at without an organ", () => {
    walkthrough({ ...step(null), organ: null, muscle: null, closeup: null, process: null });
    expect(processOnScreen(getState())).toBeNull();
    leaveAsk();
  });

  it("shows a composed drawing for as long as the step does", () => {
    walkthrough({ ...step(null), closeup: null, composed }, step(null));
    expect(composedOnScreen(getState())?.caption).toBe("A torn vessel");
    goToStep(1);
    expect(composedOnScreen(getState())).toBeNull();
    leaveAsk();
  });

  it("draws an injury's line only while exploring it", () => {
    const from = Math.round(getState().t) - 30;
    const custom = { systems: ["circulation" as const], effects: [{ channel: "heartRate" as const, amount: 30, rise_min: 10, half_life_min: 60 }], feelings: [], stops: [{ organ: "liver" as const, muscle: null, label: "Liver", after_min: 0, say: "It tears the liver.", routes: [] }], track: { aim: "liver" as const, from: "front" as const, crossed: [{ organ: "liver" as const, name: "liver" }] } };
    expect(trackOnScreen(getState())).toBeNull();
    enterAsk();
    dispatch({ name: "log_event", args: { id: "wound", label: "Wound", preset: "custom", from, until: null, intensity: 0.5, muscles: [], symptoms: [], source: "My estimate", custom } });
    expect(trackOnScreen(getState())?.aim).toBe("liver");
    leaveAsk();
    expect(trackOnScreen(getState())).toBeNull();
  });
});
