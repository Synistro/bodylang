import { describe, expect, it } from "vitest";
import { encodeEvent, readEvents, TellEvent, tellEventSchema } from "./wire";

const read = async (body: string) => {
  const out: TellEvent[] = [];
  for await (const event of readEvents(new Response(body), tellEventSchema)) out.push(event);
  return out;
};

describe("the event stream", () => {
  const events: TellEvent[] = [{ type: "action", name: "show_system", args: { system: "brain" } }, { type: "reply", lines: [{ text: "Your heart is steady.", unverified: ["7.9"] }] }, { type: "done" }];

  it("reads back what was sent", async () => {
    expect(await read(events.map(encodeEvent).join(""))).toEqual(events);
  });

  it("reads an event split across chunks", async () => {
    const whole = encodeEvent(events[0]);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(whole.slice(0, 10)));
        controller.enqueue(new TextEncoder().encode(whole.slice(10)));
        controller.close();
      },
    });
    const out: TellEvent[] = [];
    for await (const event of readEvents(new Response(stream), tellEventSchema)) out.push(event);
    expect(out).toEqual([events[0]]);
  });

  it("refuses an event it doesn't know", async () => {
    await expect(read('data: {"type":"surprise"}\n\n')).rejects.toThrow();
  });
});
