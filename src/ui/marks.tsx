import type { ReadingScale, Tone, Trend } from "../model/assess/types";
import { SYSTEM_HUE, Theme } from "../look";
import { clamp01 } from "../model/curve";

const TREND_ANGLE: Record<Trend, number> = { rising: -45, steady: 0, falling: 45 };

// The system colours as CSS variables, so markup can name a system and stay out of the palette.
export function applyHues(theme: Theme) {
  const style = document.documentElement.style;
  for (const [system, hue] of Object.entries(SYSTEM_HUE)) style.setProperty(`--hue-${system}`, hue[theme]);
}

// A value with a digit in it reads as a number; "Moderate" or "Irritated" read as words.
export const isNumeric = (text: string) => /\d/.test(text);

// One arrow that turns, so a change of direction reads as a movement instead of a swap.
export function TrendMark({ trend }: { trend: Trend }) {
  return (
    <svg
      className="trend"
      data-trend={trend}
      viewBox="0 0 10 10"
      style={{ transform: `rotate(${TREND_ANGLE[trend]}deg)` }}
      role="img"
      aria-label={trend}
    >
      <path
        d="M1.2 5h7.3M5.6 2.1 8.5 5 5.6 7.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A reading past its typical band owes an explanation, even when it's nothing to worry about.
export const outsideTypical = ({ value, scale }: { value: number; scale: ReadingScale }) =>
  value < scale.typicalLow || value > scale.typicalHigh;

// A typical band and a dot for you.
export function RangeBar({ scale, value, tone }: { scale: ReadingScale; value: number; tone: Tone }) {
  const span = scale.max - scale.min || 1;
  const at = (v: number) => clamp01((v - scale.min) / span) * 100;
  const low = at(scale.typicalLow);
  const high = at(scale.typicalHigh);
  return (
    <span className="range" data-tone={tone} aria-hidden="true">
      <i className="range-track" />
      <i className="range-band" style={{ left: `${low}%`, width: `${high - low}%` }} />
      <i className="range-dot" style={{ left: `${at(value)}%` }} />
    </span>
  );
}
