import { pointAlong, Polyline, polyline, sampleTube, seededRandom, tenth } from "./draw";
import type { Frame } from "./loop";

const STILL_CLOCK = 11;

// A smooth line through some points: how to draw it, and how to travel along it.
export function curve(points: [number, number][], samples = 48): { d: string; route: Polyline } {
  const tube = sampleTube(
    points.map(([x, y]) => ({ x, y, r: 0 })),
    samples,
  );
  return { d: tube.map((p, i) => `${i ? "L" : "M"}${tenth(p.x)} ${tenth(p.y)}`).join(""), route: polyline(tube) };
}

export type Placer = (progress: number, seat: number) => { x: number; y: number; opacity?: number };

export const along =
  (route: Polyline): Placer =>
  (progress) =>
    pointAlong(route, progress);

// Dots that appear at a rate the model sets and travel for a fixed time. How fast something happens in
// the body is how many dots there are, and a still picture shows those in flight at that rate.
export function createStream(dots: (SVGCircleElement | SVGEllipseElement)[], lifeSeconds: number, seed: number) {
  const random = seededRandom(seed);
  // Float64, because Float32 rounds the clock, often upward, and that gives a new dot a negative age.
  const born = new Float64Array(dots.length).fill(-Infinity);
  const seats = new Float32Array(dots.length);
  let due = 0;
  let next = 0;
  let started = false;
  return ({ dt, clock, still }: Frame, perSecond: number, place: Placer) => {
    const now = still ? STILL_CLOCK : clock;
    // A figure opens already going, with the dots this rate would have in flight, and a slow one
    // doesn't sit empty until they build up.
    if (!still && !started) {
      started = true;
      const inFlight = Math.min(dots.length, Math.round(perSecond * lifeSeconds));
      for (let k = 0; k < inFlight; k++) {
        born[k] = now - ((k + 0.5) / inFlight) * lifeSeconds;
        seats[k] = random();
      }
      next = inFlight % dots.length;
    }
    if (still) {
      const inFlight = Math.min(dots.length, Math.round(perSecond * lifeSeconds));
      for (let k = 0; k < dots.length; k++) {
        born[k] = k < inFlight ? now - ((k + 0.5) / inFlight) * lifeSeconds : -Infinity;
        seats[k] = ((k * 7) % dots.length) / dots.length;
      }
    } else {
      due += dt * perSecond;
      while (due >= 1) {
        due -= 1;
        born[next] = now;
        seats[next] = random();
        next = (next + 1) % dots.length;
      }
    }
    for (let k = 0; k < dots.length; k++) {
      const age = now - born[k];
      if (age > lifeSeconds) {
        dots[k].style.visibility = "hidden";
        continue;
      }
      const at = place(age / lifeSeconds, seats[k]);
      dots[k].setAttribute("cx", tenth(at.x));
      dots[k].setAttribute("cy", tenth(at.y));
      dots[k].style.opacity = at.opacity === undefined ? "" : tenth(at.opacity);
      dots[k].style.visibility = "visible";
    }
  };
}
