import { afterEach, describe, expect, it, vi } from "vitest";
import { readEvents, tellEventSchema } from "../wire";
import { replayOf } from "./replay";

const reply = { type: "reply", lines: [{ text: "Done.", organ: "heart", unverified: [] }] };
const recorded = [
  { ms: 10, event: { type: "action", name: "set_now", args: { at: 600 } } },
  { ms: 40_000, event: reply },
  { ms: 40_100, event: { type: "done" } },
];

describe("a recorded answer, replayed", () => {
  afterEach(() => vi.useRealTimers());

  it("streams the events in the form a live answer has, so the same reader takes them", async () => {
    const response = await replayOf(recorded, 0)({}, new AbortController().signal);
    const events = [];
    for await (const event of readEvents(response, tellEventSchema)) events.push(event.type);
    expect(events).toEqual(["action", "reply", "done"]);
  });

  it("shrinks a long wait while the LLM thought, and keeps short gaps as they were", async () => {
    vi.useFakeTimers();
    const response = await replayOf(recorded, 900)({}, new AbortController().signal);
    const reader = response.body!.getReader();
    const arrivals: number[] = [];
    const reading = (async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) return;
        arrivals.push(Date.now());
      }
    })();
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(2_000);
    await reading;
    expect(arrivals.map((at) => at - start)).toEqual([10, 910, 1010]);
  });

  it("stops when the person leaves", async () => {
    const stop = new AbortController();
    const response = await replayOf(recorded, 5_000)({}, stop.signal);
    stop.abort();
    await expect(response.body!.getReader().read()).rejects.toThrow("Stopped");
  });
});
