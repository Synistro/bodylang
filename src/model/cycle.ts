import { CYCLE } from "./params";

// The menstrual cycle as a typical curve, placed by the date you give. It says what is typical for
// this day of a cycle of this length, and it can't tell when you really ovulate.
export interface Cycle {
  start: number; // the minute your latest period began, negative when that was before today
  lengthDays: number;
  periodDays: number;
}

export type CyclePhase = "period" | "follicular" | "ovulation" | "luteal";

const MINUTES_A_DAY = 1440;

// Days since this cycle began, with a fraction, however many cycles ago the given date was.
export function daysIntoCycle(cycle: Cycle, t: number): number {
  const length = cycle.lengthDays * MINUTES_A_DAY;
  return ((((t - cycle.start) % length) + length) % length) / MINUTES_A_DAY;
}

export const cycleDay = (cycle: Cycle, t: number) => Math.floor(daysIntoCycle(cycle, t)) + 1;

const ovulationDay = (cycle: Cycle) => cycle.lengthDays - CYCLE.lutealDays;

export function cyclePhase(cycle: Cycle, t: number): CyclePhase {
  const day = daysIntoCycle(cycle, t);
  if (day < cycle.periodDays) return "period";
  const fromOvulation = day - ovulationDay(cycle);
  if (Math.abs(fromOvulation) <= CYCLE.aroundOvulationDays) return "ovulation";
  return fromOvulation < 0 ? "follicular" : "luteal";
}

// Minutes until the next period starts.
export function minutesToNextPeriod(cycle: Cycle, t: number): number {
  return (cycle.lengthDays - daysIntoCycle(cycle, t)) * MINUTES_A_DAY;
}

interface Bump {
  amount: number;
  atDay: number;
  widthDays: number;
}

// One rise and fall, in days from ovulation, wrapped so the end of a cycle runs into the next.
function bump({ amount, atDay, widthDays }: Bump, fromOvulation: number, length: number): number {
  let sum = 0;
  for (const wrap of [-length, 0, length])
    sum += Math.exp(-((fromOvulation - atDay + wrap) ** 2) / (2 * widthDays ** 2));
  return amount * sum;
}

export interface Hormones {
  estradiol: number; // pmol/L
  progesterone: number; // nmol/L
  lh: number; // IU/L
}

export function hormonesAt(cycle: Cycle, t: number): Hormones {
  const fromOvulation = daysIntoCycle(cycle, t) - ovulationDay(cycle);
  const { estradiol, progesterone, lh } = CYCLE.hormones;
  return {
    estradiol:
      estradiol.base +
      bump(estradiol.ovulatory, fromOvulation, cycle.lengthDays) +
      bump(estradiol.luteal, fromOvulation, cycle.lengthDays),
    progesterone: progesterone.base + bump(progesterone.luteal, fromOvulation, cycle.lengthDays),
    lh: lh.base + bump(lh.surge, fromOvulation, cycle.lengthDays),
  };
}

// How far into the progesterone rise this is, 0 to 1. Everything the luteal phase changes follows it.
export function lutealShare(cycle: Cycle, t: number): number {
  const { base, luteal } = CYCLE.hormones.progesterone;
  return Math.max(0, Math.min(1, (hormonesAt(cycle, t).progesterone - base) / luteal.amount));
}

// How likely cramps are to be felt, 0 to 1: strongest at the start of a period, fading through it.
export function crampLevel(cycle: Cycle, t: number): number {
  const day = daysIntoCycle(cycle, t);
  if (day >= cycle.periodDays) return 0;
  return CYCLE.cramps.amount * Math.exp(-day / CYCLE.cramps.fadeDays);
}

// How much of the lining is there, 0 to 1. It sheds through a period and rebuilds up to ovulation.
export function liningShare(cycle: Cycle, t: number): number {
  const day = daysIntoCycle(cycle, t);
  const { least, atOvulation } = CYCLE.lining;
  if (day < cycle.periodDays) return 1 - (1 - least) * (day / cycle.periodDays);
  const ovulation = ovulationDay(cycle);
  if (day < ovulation)
    return least + (atOvulation - least) * ((day - cycle.periodDays) / Math.max(1, ovulation - cycle.periodDays));
  return atOvulation + (1 - atOvulation) * Math.min(1, (day - ovulation) / CYCLE.lutealDays);
}
