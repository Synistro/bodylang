// Searches along a per-minute curve, and the one clamp everything shares.

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Where a curve is highest from `from` up to, but not including, `until`.
export function peakIndex(curve: Float32Array, from: number, until: number = curve.length): number {
  let best = from;
  for (let i = from; i < Math.min(until, curve.length); i++) if (curve[i] > curve[best]) best = i;
  return best;
}

// The first minute from `from` on that a curve is below a level.
export function firstIndexBelow(curve: Float32Array, from: number, level: number): number | null {
  for (let i = from; i < curve.length; i++) if (curve[i] < level) return i;
  return null;
}

// What is left after some minutes, for something that halves at a steady rate.
export const decay = (minutes: number, halfLifeMin: number) => 0.5 ** (minutes / halfLifeMin);
