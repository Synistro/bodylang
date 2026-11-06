import { describe, expect, it } from "vitest";
import { createStream } from "./stream";

// The stream only moves its dots, so these stand in for the SVG circles.
const fakeDots = (count: number) =>
  Array.from({ length: count }, () => ({ setAttribute: () => undefined, style: {} })) as unknown as SVGCircleElement[];

describe("a stream of dots", () => {
  it("never places a dot before it is born", () => {
    const stream = createStream(fakeDots(30), 4.2, 23);
    const dt = 1 / 60;
    let earliest = 0;
    let clock = 0;
    for (let frame = 0; frame < 5000; frame++) {
      clock += dt;
      stream({ dt, clock, still: false }, 4.5, (progress) => {
        earliest = Math.min(earliest, progress);
        return { x: 0, y: 0 };
      });
    }
    expect(earliest).toBeGreaterThanOrEqual(0);
  });
});
