import { memo } from "react";
import { FEEL, PROCESS } from "../../model/params";
import { value } from "../../model/simulate";
import { clamp01, lerp, parts, seededRandom, smoothstep } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";

const SIDE = 10;
const COLUMN_STEP = 15;
const ROW_STEP = 14.6;
const GRID_LEFT = 5.4;
const GRID_TOP = 32;
const CUP = "M-4.6 -6C-4.6 -1.6 -3 0 0 0C3 0 4.6 -1.6 4.6 -6";
const SEATED_Y = -3;
const CAFFEINE_MARK = "M0 -3.4L3.2 0L0 3.4L-3.2 0Z";
const DOCK_PERIOD = { shortest: 9, longest: 16 }; // seconds, slow enough to follow one mark
const STILL_CLOCK = 37;
const KEY = { x: 166, wordX: 176, y: 76, step: 18 };

// A fixed order that stays evenly spread at every count, so the same seats stay blocked as the
// timeline moves and more of them simply join in.
const BLOCK_ORDER = (() => {
  const plastic = 1.32471795724;
  const free = new Set(Array.from({ length: SIDE * SIDE }, (_, i) => i));
  const order: number[] = [];
  for (let n = 1; order.length < SIDE * SIDE; n++) {
    const column = Math.floor(((0.5 + n / plastic) % 1) * SIDE);
    const row = Math.floor(((0.5 + n / (plastic * plastic)) % 1) * SIDE);
    let best = -1;
    let bestDistance = Infinity;
    for (const cell of free) {
      const distance = Math.hypot((cell % SIDE) - column, Math.floor(cell / SIDE) - row);
      if (distance < bestDistance) {
        best = cell;
        bestDistance = distance;
      }
    }
    free.delete(best);
    order.push(best);
  }
  return order;
})();

const RANK = (() => {
  const rank = new Array<number>(SIDE * SIDE);
  BLOCK_ORDER.forEach((cell, i) => (rank[cell] = i));
  return rank;
})();

const RHYTHM = (() => {
  const random = seededRandom(23);
  return Array.from({ length: SIDE * SIDE }, () => ({ period: lerp(DOCK_PERIOD.shortest, DOCK_PERIOD.longest, random()), offset: random() }));
})();

function createBrainPainter(art: SVGSVGElement): Painter {
  const blockers = parts<SVGPathElement>(art, "blocker");
  const dockers = parts<SVGCircleElement>(art, "docker");
  const shownBlocked = new Array<boolean>(SIDE * SIDE).fill(false);
  return ({ clock, still }, { trajectory, t }) => {
    const blocked = Math.round(value(trajectory, "occupancy", t) * 100);
    // The tired signal builds the longer you stay awake, so more of the free seats are taken late in the day.
    const dockedShare = lerp(0.35, 0.82, clamp01(value(trajectory, "sleepPressure", t) / (PROCESS.sleepPressureFullH * FEEL.sleepPressurePerHour)));
    const now = still ? STILL_CLOCK : clock;
    for (let cell = 0; cell < SIDE * SIDE; cell++) {
      const isBlocked = RANK[cell] < blocked;
      if (isBlocked !== shownBlocked[cell]) {
        shownBlocked[cell] = isBlocked;
        blockers[cell].toggleAttribute("data-seated", isBlocked);
      }
      const { period, offset } = RHYTHM[cell];
      const cycle = (now / period + offset) % 1;
      // A signal fades into its seat and out again. A seat caffeine holds stays closed to it.
      const presence = isBlocked ? 0 : smoothstep(0, 0.08, cycle) * (1 - smoothstep(dockedShare, dockedShare + 0.08, cycle));
      dockers[cell].style.opacity = String(Math.round(presence * 100) / 100);
    }
  };
}

const Seat = memo(function Seat() {
  return <path className="line-soft" d={CUP} />;
});

const Receptors = memo(function Receptors() {
  return (
    <g>
      {Array.from({ length: SIDE * SIDE }, (_, cell) => (
        <g key={cell} transform={`translate(${GRID_LEFT + (cell % SIDE) * COLUMN_STEP} ${GRID_TOP + Math.floor(cell / SIDE) * ROW_STEP})`}>
          <circle data-part="docker" className="brain-signal" cx="0" cy={SEATED_Y} r="2.3" />
          <Seat />
          <path data-part="blocker" className="brain-caffeine" transform={`translate(0 ${SEATED_Y})`} d={CAFFEINE_MARK} />
        </g>
      ))}
    </g>
  );
});

// Three marks, three names. That is all it takes to see why caffeine keeps you awake.
const Key = memo(function Key() {
  const row = (i: number) => KEY.y + i * KEY.step;
  return (
    <g>
      <g transform={`translate(${KEY.x} ${row(0)})`}>
        <circle className="brain-signal" cx="0" cy={SEATED_Y} r="2.3" />
        <Seat />
      </g>
      <text x={KEY.wordX} y={row(0) - 1}>Tired signal</text>
      <g transform={`translate(${KEY.x} ${row(1)})`}>
        <Seat />
        <path className="brain-caffeine" data-seated="" transform={`translate(0 ${SEATED_Y})`} d={CAFFEINE_MARK} />
      </g>
      <text x={KEY.wordX} y={row(1) - 1}>Caffeine in its seat</text>
      <g transform={`translate(${KEY.x} ${row(2)})`}>
        <Seat />
      </g>
      <text x={KEY.wordX} y={row(2) - 1}>Empty seat</text>
    </g>
  );
});

export function BrainInset(props: InsetProps) {
  const art = useInsetPainter(createBrainPainter, props);
  const blocked = Math.round(value(props.trajectory, "occupancy", props.t) * 100);
  const caption = `${blocked} of 100 tired signals blocked`;
  return (
    <Plate caption={caption} describe={`100 seats on a brain cell. Caffeine sits in ${blocked} of them, so the tired signal can't land there.`} artRef={art}>
      <Receptors />
      <Key />
    </Plate>
  );
}
