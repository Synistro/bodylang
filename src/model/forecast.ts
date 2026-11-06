import type { Trajectory } from "./engine/trajectory";
import { CAFFEINE, DAY, PROCESS } from "./params";

export interface Forecast {
  glucosePeak: { at: number; value: number } | null;
  glucoseSettles: number | null;
  sleepiest: { at: number; value: number } | null;
  stomachHalf: number | null;
  stomachEmpty: number | null;
  tgPeak: { at: number; value: number } | null;
  caffeineBelowFelt: number | null;
  caffeineAtBedMgL: number;
}

export function forecast(tr: Trajectory, now: number): Forecast {
  const n = tr.series.glucose.length;
  const start = Math.floor(now);
  const peak = (s: Float32Array, to: number) => {
    let best = start;
    for (let i = start; i < Math.min(to, n); i++) if (s[i] > s[best]) best = i;
    return best;
  };
  const firstBelow = (s: Float32Array, level: number) => {
    for (let i = start; i < n; i++) if (s[i] < level) return i;
    return null;
  };
  const base = tr.anthro.baselineGlucose;
  const gp = peak(tr.series.glucose, start + 300);
  const glucosePeak = tr.series.glucose[gp] > base + 4 ? { at: gp, value: tr.series.glucose[gp] } : null;
  let glucoseSettles: number | null = null;
  if (glucosePeak) for (let i = gp; i < n; i++) if (tr.series.glucose[i] < base + 8) { glucoseSettles = i; break; }
  const dp = peak(tr.series.drowsy, start + 300);
  const sleepiest = tr.series.drowsy[dp] > PROCESS.sleepyNamedFrom ? { at: dp, value: tr.series.drowsy[dp] } : null;
  const kcalNow = tr.series.stomachKcal[start];
  const tp = peak(tr.series.tg, n);
  return {
    glucosePeak,
    glucoseSettles,
    sleepiest,
    stomachHalf: kcalNow > 30 ? firstBelow(tr.series.stomachKcal, kcalNow / 2) : null,
    stomachEmpty: kcalNow > 30 ? firstBelow(tr.series.stomachKcal, 8) : null,
    tgPeak: tr.series.tg[tp] > tr.anthro.baselineTg + 15 ? { at: tp, value: tr.series.tg[tp] } : null,
    caffeineBelowFelt: tr.series.caffeine[start] > CAFFEINE.feltAboveMgL ? firstBelow(tr.series.caffeine, CAFFEINE.feltAboveMgL) : null,
    caffeineAtBedMgL: tr.series.caffeine[Math.min(n - 1, DAY.sleepMin)],
  };
}
