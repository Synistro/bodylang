import { clamp01 } from "../../model/curve";
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function smoothstep(from: number, to: number, x: number) {
  const k = clamp01((x - from) / (to - from));
  return k * k * (3 - 2 * k);
}

export const bump = (x: number, center: number, width: number) => Math.exp(-(((x - center) / width) ** 2));

// Frame-rate independent easing, so a jump on the timeline reads as the organ responding.
export const easeToward = (current: number, target: number, dt: number, rate: number) =>
  current + (target - current) * (1 - Math.exp(-dt * rate));

// One decimal is finer than a pixel at this size and keeps path strings short.
export const tenth = (x: number) => String(Math.round(x * 10) / 10);

export function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TubePoint {
  x: number;
  y: number;
  r: number;
}

export interface TubeSample extends TubePoint {
  nx: number;
  ny: number;
}

function catmullRom(a: number, b: number, c: number, d: number, k: number) {
  return 0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (3 * b - a - 3 * c + d) * k * k * k);
}

export function sampleTube(control: TubePoint[], samples: number): TubeSample[] {
  const at = (i: number) => control[Math.max(0, Math.min(control.length - 1, i))];
  const points: TubeSample[] = [];
  for (let j = 0; j < samples; j++) {
    const position = (j / (samples - 1)) * (control.length - 1);
    const i = Math.min(control.length - 2, Math.floor(position));
    const k = position - i;
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    points.push({
      x: catmullRom(a.x, b.x, c.x, d.x, k),
      y: catmullRom(a.y, b.y, c.y, d.y, k),
      r: Math.max(0, catmullRom(a.r, b.r, c.r, d.r, k)),
      nx: 0,
      ny: 0,
    });
  }
  points.forEach((p, j) => {
    const before = points[Math.max(0, j - 1)];
    const after = points[Math.min(samples - 1, j + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    p.nx = dy / length;
    p.ny = -dx / length;
  });
  return points;
}

export interface Polyline {
  points: { x: number; y: number }[];
  lengths: number[];
  total: number;
}

export function polyline(points: { x: number; y: number }[]): Polyline {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return { points, lengths, total: lengths[lengths.length - 1] };
}

export function pointAlong(line: Polyline, share: number) {
  const distance = clamp01(share) * line.total;
  let i = 1;
  while (i < line.lengths.length - 1 && line.lengths[i] < distance) i++;
  const span = line.lengths[i] - line.lengths[i - 1] || 1;
  const k = (distance - line.lengths[i - 1]) / span;
  return { x: lerp(line.points[i - 1].x, line.points[i].x, k), y: lerp(line.points[i - 1].y, line.points[i].y, k) };
}

export function part<T extends Element>(root: Element, name: string): T {
  const found = root.querySelector<T>(`[data-part="${name}"]`);
  if (!found) throw new Error(`Inset figure has no part named ${name}`);
  return found;
}

export const parts = <T extends Element>(root: Element, name: string): T[] =>
  Array.from(root.querySelectorAll<T>(`[data-part="${name}"]`));
