import { describe, expect, it } from "vitest";
import { processOrigin } from "../origin";
import { processesAt } from "../processes";
import { simulate } from "../simulate";
import type { ExtensionState, ProcessExtension } from "./api";
import { checkExtension } from "./check";
import { EXTENSIONS } from "./index";

// What a good one looks like. It follows the clock and a curve of the model, along a real path.
const sample: ProcessExtension = {
  id: "sample",
  title: "Sample",
  system: "brain",
  evidence: "C",
  source: "An example for this test, with no real numbers behind it",
  params: { peakHour: 8, widthH: 5 },
  at: (view, minute) => {
    const level = Math.exp(-(((minute / 60 - 8) / 5) ** 2));
    return {
      active: level > 0.1,
      headline: level > 0.5 ? "High this morning." : "Low for now.",
      here: level > 0.1 ? "target" : null,
      stops: [
        { id: "source", organ: "brain", label: "Source", reading: `${Math.round(level * 100)}%`, share: level, flow: level, say: "It starts here.", routes: [] },
        { id: "target", organ: "liver", label: "Target", reading: `${Math.round(view.value("glucose", minute))} mg/dL`, share: level / 2, flow: level, say: "It ends here.", routes: ["carotid"] },
      ],
    };
  },
};

const withAt = (at: (minute: number) => ExtensionState): ProcessExtension => ({ ...sample, at: (_, minute) => at(minute) });
const good = (minute: number) => sample.at({ value: () => 90, body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 }, restingBpm: 65, events: [] }, minute);

describe("the contract for a new process", () => {
  it("passes a good one", () => {
    expect(checkExtension(sample, "sample")).toEqual([]);
  });

  it("wants the id to match its file", () => {
    expect(checkExtension(sample, "other").join()).toMatch(/must match the file name/);
  });

  it("wants a source and its numbers in the open", () => {
    expect(checkExtension({ ...sample, source: "" }, "sample").join()).toMatch(/must say where the numbers come from/);
    expect(checkExtension({ ...sample, params: {} }, "sample").join()).toMatch(/params must hold/);
  });

  it("rejects something that never changes", () => {
    const still = good(480);
    expect(checkExtension(withAt(() => still), "sample").join()).toMatch(/Nothing changes across the day/);
  });

  it("rejects one that throws, and says when", () => {
    const broken = withAt((minute) => {
      if (minute > 700) throw new Error("boom");
      return good(minute);
    });
    expect(checkExtension(broken, "sample").join()).toMatch(/threw boom/);
  });

  it("rejects numbers outside the scale", () => {
    const wild = withAt((minute) => ({ ...good(minute), stops: good(minute).stops.map((stop) => ({ ...stop, share: 2 })) }));
    expect(checkExtension(wild, "sample").join()).toMatch(/share is 2/);
  });

  it("rejects a broken number in its words", () => {
    const nan = withAt((minute) => ({ ...good(minute), stops: good(minute).stops.map((stop) => ({ ...stop, reading: `${NaN} ng/dL` })) }));
    expect(checkExtension(nan, "sample").join()).toMatch(/broken number/);
  });

  it("rejects a route or organ that doesn't exist", () => {
    const lost = withAt((minute) => ({ ...good(minute), stops: good(minute).stops.map((stop) => ({ ...stop, routes: ["nowhere" as never] })) }));
    expect(checkExtension(lost, "sample").join()).toMatch(/no route "nowhere"/);
  });

  it("wants a path through the vessels", () => {
    const off = withAt((minute) => ({ ...good(minute), stops: good(minute).stops.map((stop) => ({ ...stop, routes: [] })) }));
    expect(checkExtension(off, "sample").join()).toMatch(/needs a path/);
  });

  it("won't let it diagnose, or tell someone what to take", () => {
    const says = (say: string) => withAt((minute) => ({ ...good(minute), stops: good(minute).stops.map((stop) => ({ ...stop, say })) }));
    expect(checkExtension(says("You have thyroid disease."), "sample").join()).toMatch(/can't say this/);
    expect(checkExtension(says("You should feel better."), "sample").join()).toMatch(/can't say this/);
    expect(checkExtension(says("Take 2 tablets."), "sample").join()).toMatch(/can't say this/);
  });

  it("wants to know where the action is, whenever there is any", () => {
    expect(checkExtension(withAt((minute) => ({ ...good(minute), active: true, here: null })), "sample").join()).toMatch(/here must name/);
    expect(checkExtension(withAt((minute) => ({ ...good(minute), active: false, here: "target" })), "sample").join()).toMatch(/here must be null/);
  });

  it("rejects one that isn't pure", () => {
    let calls = 0;
    const counting = withAt((minute) => ({ ...good(minute), headline: `Call ${(calls += 1)}.` }));
    expect(checkExtension(counting, "sample").join()).toMatch(/must be pure/);
  });
});

describe("what has been added", () => {
  it("is found by the app", () => {
    expect(new Set(EXTENSIONS.map((extension) => extension.id)).size).toBe(EXTENSIONS.length);
  });

  it.each(EXTENSIONS.map((extension) => [extension.id, extension] as const))("%s keeps to the contract", (id, extension) => {
    expect(checkExtension(extension, id)).toEqual([]);
  });

  it.each(EXTENSIONS.map((extension) => [extension.id, extension] as const))("%s appears as a process, marked as Claude's", (id) => {
    const tr = simulate({ body: { sex: "male", age: 30, heightCm: 180, weightKg: 80 }, intakes: [], activities: [{ from: 0, posture: "sleeping" }], substances: [] });
    const line = processesAt(tr, 720).find((p) => p.id === `ext:${id}`);
    expect(line).toBeDefined();
    if (line) expect(processOrigin(tr, line).kind).toBe("claude");
  });
});
