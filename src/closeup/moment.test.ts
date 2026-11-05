import { describe, expect, it } from "vitest";
import type { GuideStep } from "../agent/actions";
import { chartOffsetHours, closeGuide, closeupOnScreen, dispatch, enterAsk, getState, goToStep, leaveAsk, muscleMinute, releaseMoment } from "../store";

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

  it("goes back to the chart on the next step that stays on it", () => {
    walkthrough(step(-1770), step(null));
    goToStep(1);
    expect(muscleMinute(getState())).toBe(getState().t);
    expect(chartOffsetHours(getState())).toBeNull();
    leaveAsk();
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
