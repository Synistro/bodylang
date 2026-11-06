import { MUSCLE_MASS_SHARE, MUSCLE_RECOVERY } from "../params";
import type { OrganId } from "../ids";
import { muscleStateFromEvent } from "./muscles";
import { ActivityBout, ChannelId, Curve, Effect, MuscleState, ResolvedEvent, StopShows } from "./types";

// Where something being fought actually is, read from the first stop of its story.
export function illnessSites(events: ResolvedEvent[], t: number, from: number): OrganId[] {
  return events.flatMap((event) => {
    const site = event.stops[0]?.organ;
    return site && event.ends === null && effectAt(event, "immune", t) >= from ? [site] : [];
  });
}

export const decay = (minutes: number, halfLifeMin: number) => 0.5 ** (minutes / halfLifeMin);

// How far along a curve is at minute t, 0 to 1.
export function curveStrength(curve: Curve, from: number, end: number | null, t: number): number {
  if (curve.after) {
    if (end === null || t < end) return 0;
    const since = t - end;
    if (since < curve.riseMin) return since / curve.riseMin;
    return decay(since - curve.riseMin, curve.halfLifeMin);
  }
  if (curve.lastMin !== undefined && end === null) return 0;
  const start = curve.lastMin !== undefined && end !== null ? end - curve.lastMin : from;
  if (t < start) return 0;
  const held = (at: number) => {
    const reached = curve.riseMin > 0 ? Math.min(1, (at - start) / curve.riseMin) : 1;
    const { settle } = curve;
    if (!settle || at - from <= settle.afterMin) return reached;
    return reached * (settle.toShare + (1 - settle.toShare) * decay(at - from - settle.afterMin, settle.halfLifeMin));
  };
  return end === null || t <= end ? held(t) : held(end) * decay(t - end, curve.halfLifeMin);
}

// A channel's value from one event at one minute.
export const effectAt = (event: ResolvedEvent, channel: ChannelId, t: number) => event.effects.reduce((sum, e) => (e.channel === channel ? sum + e.amount * curveStrength(e, event.from, event.ends, t) : sum), 0);

// Channels nothing pushes on share this one array, so a recompute stays cheap with no events.
// Index 0 is minute `start`, which is before 00:00 today when yesterday is being run first.
export function channelSeries(events: ResolvedEvent[], minutes: number, bouts: ActivityBout[] = [], start = 0): Record<ChannelId, Float32Array> {
  const zero = new Float32Array(minutes);
  const series: Record<ChannelId, Float32Array> = {
    heartRate: zero,
    breathing: zero,
    temperature: zero,
    bloodPressure: zero,
    stress: zero,
    reward: zero,
    drowsiness: zero,
    inflammation: zero,
    immune: zero,
    metabolism: zero,
    insulinSensitivity: zero,
    liverOutput: zero,
    appetite: zero,
    fluidLoss: zero,
    muscleFlow: zero,
  };
  const sources: { from: number; end: number | null; effects: Effect[] }[] = [...events.map((e) => ({ from: e.from, end: e.ends, effects: e.effects })), ...bouts];
  for (const source of sources) {
    for (const effect of source.effects) {
      if (series[effect.channel] === zero) series[effect.channel] = new Float32Array(minutes);
      const out = series[effect.channel];
      for (let i = 0; i < minutes; i++) out[i] += effect.amount * curveStrength(effect, source.from, source.end, i + start);
    }
  }
  return series;
}

// Share of the body's muscle working at each minute, weighted by how much muscle each group holds.
export function muscleWorkSeries(events: ResolvedEvent[], minutes: number, start = 0): Float32Array {
  const out = new Float32Array(minutes);
  for (const event of events) {
    if (event.ends === null || !event.muscles.length) continue;
    const share = event.muscles.reduce((sum, m) => sum + m.load * MUSCLE_MASS_SHARE[m.group], 0) * event.intensity;
    const fall = MUSCLE_RECOVERY.workFallHalfLifeMin;
    for (let i = Math.max(0, event.from - start); i < minutes; i++) {
      const t = i + start;
      out[i] += t <= event.ends ? share : share * decay(t - event.ends, fall);
    }
  }
  return out;
}

// How much is still going on from this event, 0 to 1. Below the active floor it counts as over.
export function eventLevelAt(event: ResolvedEvent, t: number): number {
  if (t < event.from) return 0;
  let level = 0;
  for (const effect of event.effects) level = Math.max(level, curveStrength(effect, event.from, event.ends, t));
  for (const feeling of event.feelings) level = Math.max(level, curveStrength(feeling, event.from, event.ends, t));
  if (event.ends !== null) {
    for (const m of event.muscles) {
      const s = muscleStateFromEvent(event, event.ends, m.load, t);
      level = Math.max(level, s.work, s.fatigue, s.soreness, s.repair);
    }
  }
  return level;
}

export const eventActiveAt = (event: ResolvedEvent, t: number) => eventLevelAt(event, t) >= MUSCLE_RECOVERY.activeAbove;

// Which stop is current: the last one on the main line whose time has come.
export function currentStopIndex(event: ResolvedEvent, t: number): number {
  const elapsed = t - event.from;
  let at = -1;
  event.stops.forEach((stop, index) => {
    if (stop.afterMin <= elapsed && stop.branchOf === undefined) at = index;
  });
  return at;
}

export const MUSCLE_STATES: readonly (keyof MuscleState)[] = ["work", "fatigue", "soreness", "repair", "glycogenUsed"];

export const isMuscleState = (shows: StopShows): shows is keyof MuscleState => MUSCLE_STATES.some((state) => state === shows);
