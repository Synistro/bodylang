import { DAY, FEELING_DISPLAY, REFERENCE } from "../../params";
import { inSentence, levelWord } from "../../words";
import { ReadingSpec, Sample, alertnessDrains, always, caffeineDoseMgL, caffeineLeft, caffeinePresent, causeOf, clock, costsSleep, extremeAhead, fixed, identity, near, peakAhead, peaksAt, percentOf, reaches, rounded, startedBy, minutesUntilSleep } from "../context";
import { EXPECTED, HIGH, LOW, NORMAL, SLIGHTLY_RAISED, quiet, unpainted } from "../verdicts";

export const caffeineSpec: ReadingSpec = {
  label: "Caffeine",
  organ: "brain",
  series: "caffeine",
  unit: "mg/L",
  toValue: identity,
  format: fixed(2),
  trendEpsilon: 0.005,
  headingChange: 0.05,
  range: (c) => {
    const r = REFERENCE.caffeine;
    const typicalHigh = caffeineDoseMgL(c, r.singleDoseMg);
    return { min: 0, max: r.scaleMaxMgL, typicalLow: 0, typicalHigh, typicalLabel: `Under ${typicalHigh.toFixed(1)} mg/L, a ${r.singleDoseMg} mg dose for you`, evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.caffeine;
    if (s.raw >= caffeineDoseMgL(c, r.dailyDoseMg)) return HIGH;
    if (s.raw >= caffeineDoseMgL(c, r.singleDoseMg)) return SLIGHTLY_RAISED;
    if (costsSleep(c)) return { ...EXPECTED, tone: "note" };
    return caffeinePresent(c) ? EXPECTED : quiet("None");
  },
  why: [
    [(c) => !caffeinePresent(c), () => "No caffeine in your blood"],
    [
      (c) => c.eaten.filter((i) => i.caffeineMg > 0).length === 1,
      (c) => {
        const drink = c.eaten.filter((i) => i.caffeineMg > 0)[0];
        const { left, dose } = caffeineLeft(c);
        return `Your ${inSentence(drink.label)} at ${clock(drink.at)}. ${Math.round(left)} of ${Math.round(dose)} mg left`;
      },
    ],
    [
      always,
      (c) => {
        const { left, dose } = caffeineLeft(c);
        return `${Math.round(left)} of the ${Math.round(dose)} mg you drank is left`;
      },
    ],
  ],
  forecast: [
    (c) => {
      if (!caffeinePresent(c) || c.t >= DAY.sleepMin) return null;
      const atBed = c.v("caffeine", DAY.sleepMin);
      return { text: costsSleep(c) ? `Still ${atBed.toFixed(1)} mg/L at ${clock(DAY.sleepMin)}, which may cost you sleep` : `${atBed.toFixed(2)} mg/L left by ${clock(DAY.sleepMin)}`, short: `${atBed.toFixed(costsSleep(c) ? 1 : 2)} mg/L at ${clock(DAY.sleepMin)}`, at: DAY.sleepMin };
    },
  ],
};

const receptorsClear = (s: Sample) => s.value < REFERENCE.receptors.clearBelowPercent;

export const receptorsSpec: ReadingSpec = {
  label: "Tired signal blocked",
  organ: "brain",
  series: "occupancy",
  unit: "%",
  toValue: percentOf,
  format: rounded,
  trendEpsilon: 0.002,
  headingChange: 0.02,
  range: () => {
    const r = REFERENCE.receptors;
    return { min: 0, max: 100, typicalLow: 0, typicalHigh: r.high, typicalLabel: `Up to about ${r.high}% from several cups a day`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => {
    if (s.value >= REFERENCE.receptors.high) return SLIGHTLY_RAISED;
    return receptorsClear(s) ? quiet("Clear") : EXPECTED;
  },
  why: [
    [(_c, s) => receptorsClear(s), () => "No caffeine in the way"],
    [always, () => "Caffeine sits where the tired signal would land"],
  ],
  forecast: [
    peaksAt(0.02, (raw) => `Peaks at ${Math.round(raw * 100)}%`),
    reaches(
      (_c, s) => s.value >= 2,
      (raw) => raw * 100 < 1,
      () => "Under 1%",
    ),
  ],
};

export const alertnessSpec: ReadingSpec = {
  label: "Alertness",
  organ: "brain",
  series: "alertness",
  unit: "",
  toValue: percentOf,
  format: (x) => levelWord(x / 100),
  trendEpsilon: 0.005,
  headingChange: 0.03,
  range: () => {
    const r = REFERENCE.alertness;
    return { min: 0, max: 100, typicalLow: r.low, typicalHigh: r.high, typicalLabel: "My estimate of a usual waking day", evidence: r.evidence, source: r.source };
  },
  judge: (c, s) => {
    const r = REFERENCE.alertness;
    if (c.asleep) return quiet("Asleep");
    if (s.value > r.high) return EXPECTED;
    return s.value < r.low ? unpainted(LOW) : NORMAL;
  },
  why: [
    [(c) => c.asleep, () => "You are asleep"],
    [(c) => startedBy("stress", 0.2)(c) && !c.training, (c) => `Held up by ${causeOf(c, "stress", 0.2) ?? ""}`],
    [(c, s) => s.value > 80 && c.v("caffeineFelt") >= 0.2, () => "Held up by caffeine"],
    [(c) => alertnessDrains(c) !== null, (c) => alertnessDrains(c) ?? ""],
    [always, () => "You are early in your day"],
  ],
  forecast: [
    (c) => {
      if (c.asleep) return null;
      const horizonEnd = Math.min(c.t + REFERENCE.headingHorizonMin, minutesUntilSleep(c));
      // The same moment the Sleepy feeling names, so the two never disagree by a minute.
      const sleepiest = peakAhead(c, "drowsy", 0.02, FEELING_DISPLAY.peakHorizonMin);
      if (sleepiest && sleepiest.at <= horizonEnd) return near("Lowest", sleepiest.at);
      const low = extremeAhead(c, "alertness", "min");
      if (low.at > c.t + 2 && low.at <= horizonEnd && c.v("alertness") - low.value >= 0.03) return near("Lowest", low.at);
      const high = peakAhead(c, "alertness", 0.03);
      return high && high.at <= horizonEnd ? near("Picks up", high.at) : null;
    },
  ],
};

const alcoholPresent = (s: Sample) => s.raw >= REFERENCE.alcohol.presentAboveGPerL;

export const alcoholSpec: ReadingSpec = {
  label: "Alcohol",
  organ: "liver",
  series: "alcohol",
  unit: "g/L",
  toValue: identity,
  format: fixed(2),
  trendEpsilon: 0.003,
  headingChange: 0.02,
  range: () => {
    const r = REFERENCE.alcohol;
    return { min: 0, max: r.scaleMaxGPerL, typicalLow: 0, typicalHigh: r.limitGPerL, typicalLabel: `Crash risk climbs from ${r.riskGPerL} g/L`, evidence: r.evidence, source: r.source };
  },
  judge: (_c, s) => {
    const r = REFERENCE.alcohol;
    if (s.raw >= r.limitGPerL) return HIGH;
    if (s.raw >= r.riskGPerL) return SLIGHTLY_RAISED;
    return alcoholPresent(s) ? EXPECTED : quiet("None");
  },
  why: [
    [(_c, s) => alcoholPresent(s) && s.trend === "rising", () => "It is still crossing from your gut"],
    [(_c, s) => alcoholPresent(s), () => "Your liver is clearing it at a steady rate"],
    [always, () => "No alcohol in your blood"],
  ],
  forecast: [
    peaksAt(0.02, (raw) => `Peaks at ${raw.toFixed(2)}`),
    reaches(
      (_c, s) => alcoholPresent(s),
      (raw) => raw < REFERENCE.alcohol.presentAboveGPerL,
      () => "Clear",
    ),
  ],
};
