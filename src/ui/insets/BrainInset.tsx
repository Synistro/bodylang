import { memo } from "react";
import { brainCloseup } from "../../closeup/brain";
import type { Levels } from "../../closeup/define";
import { closeupInset, Look } from "./closeupInset";
import { lerp, parts, smoothstep } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import type { PlateWords } from "./Plate";
import { createStream, Placer } from "./stream";

type Setting = (typeof brainCloseup.keys)[number];

const SEATS = 14;
const SEAT_STEP = 16;
const FIRST_SEAT_X = (240 - (SEATS - 1) * SEAT_STEP) / 2;
const CELL_Y = 118;
const FALL_FROM_Y = 30;
const IN_SEAT_Y = CELL_Y - 4;
const CUP = "M-6 -8C-6 -2.2 -4 0 0 0C4 0 6 -2.2 6 -8";
const CAFFEINE_MARK = "M0 -4.4L4.2 0L0 4.4L-4.2 0Z";
const FALLS_FOR = 0.62; // of a signal's life; the rest is landing or bouncing off
const BOUNCE = { height: 26, drift: 9 };
const SIGNALS = { pool: 30, seconds: 4.2, least: 0.5, most: 4.5 };
const KEY = { markX: FIRST_SEAT_X, wordX: FIRST_SEAT_X + 10, firstY: 148, step: 14 };

const seatX = (seat: number) => FIRST_SEAT_X + seat * SEAT_STEP;

// Which seats caffeine takes first, spread evenly, so the same ones stay held and more join as it rises.
const RANK = Array.from({ length: SEATS }, (_, seat) => seat)
  .sort((a, b) => ((a * 0.618) % 1) - ((b * 0.618) % 1))
  .reduce<number[]>((rank, seat, order) => {
    rank[seat] = order;
    return rank;
  }, []);

const heldSeats = (share: number) => {
  const held = Math.round(share * SEATS);
  return share >= 0.01 ? Math.max(1, held) : 0;
};

function paintBrain(art: SVGSVGElement) {
  const marks = parts<SVGPathElement>(art, "caffeine");
  const signals = createStream(parts(art, "signal"), SIGNALS.seconds, 23);
  const tired = parts<SVGGElement>(art, "tired");
  const caffeine = parts<SVGGElement>(art, "held");
  let held = 0;
  // A signal falls to its seat. A free seat takes it, and it fades there. One caffeine holds sends it back.
  const fall: Placer = (progress, spot) => {
    const seat = Math.floor(spot * SEATS) % SEATS;
    const x = seatX(seat);
    if (progress < FALLS_FOR) return { x, y: lerp(FALL_FROM_Y, IN_SEAT_Y, (progress / FALLS_FOR) ** 1.4) };
    const after = (progress - FALLS_FOR) / (1 - FALLS_FOR);
    if (RANK[seat] >= held) return { x, y: IN_SEAT_Y, opacity: 1 - smoothstep(0.4, 1, after) };
    const away = spot * 7 % 1 < 0.5 ? -1 : 1;
    return { x: x + away * BOUNCE.drift * after, y: IN_SEAT_Y - 7 - BOUNCE.height * Math.sin(after * Math.PI * 0.6), opacity: 1 - smoothstep(0.2, 1, after) };
  };
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    held = heldSeats(levels.caffeine);
    marks.forEach((mark, seat) => mark.toggleAttribute("data-seated", RANK[seat] < held));
    // The tired signal builds the longer you are awake, so there is more of it late in the day.
    signals(frame, lerp(SIGNALS.least, SIGNALS.most, levels.tired), fall);
    for (const group of tired) setLit(group, lit.tired);
    for (const group of caffeine) setLit(group, lit.caffeine);
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <g data-part="tired">
        {Array.from({ length: SIGNALS.pool }, (_, k) => (
          <circle key={k} data-part="signal" className="brain-signal" r="2.6" />
        ))}
      </g>
      {Array.from({ length: SEATS }, (_, seat) => (
        <path key={seat} className="line-soft" transform={`translate(${seatX(seat)} ${CELL_Y})`} d={CUP} />
      ))}
      <g data-part="held">
        {Array.from({ length: SEATS }, (_, seat) => (
          <path key={seat} data-part="caffeine" className="brain-caffeine" transform={`translate(${seatX(seat)} ${CELL_Y - 4})`} d={CAFFEINE_MARK} />
        ))}
      </g>
      <path className="line-ink" d={`M${FIRST_SEAT_X - 7} ${CELL_Y + 1.5}H${240 - FIRST_SEAT_X + 7}`} />
      <text className="inset-quiet" x={240 - FIRST_SEAT_X + 7} y={CELL_Y + 11} textAnchor="end">Surface of a brain cell</text>
      <g data-part="tired">
        <circle className="brain-signal" cx={KEY.markX} cy={KEY.firstY - 2.4} r="2.6" />
        <text x={KEY.wordX} y={KEY.firstY}>Tired signal: when it lands in a seat, you feel sleepier</text>
      </g>
      <g data-part="held">
        <path className="brain-caffeine" data-seated="" transform={`translate(${KEY.markX} ${KEY.firstY + KEY.step - 2.4})`} d={CAFFEINE_MARK} />
        <text x={KEY.wordX} y={KEY.firstY + KEY.step}>Caffeine: holds the seat, so the signal bounces off</text>
      </g>
    </>
  );
});

function useBrainPlate(_props: InsetProps, levels: Levels<Setting>): PlateWords {
  const blocked = Math.round(levels.caffeine * 100);
  return {
    caption: blocked >= 1 ? `Caffeine is blocking ${blocked}% of your tired signal` : "Nothing is blocking your tired signal",
    describe: `Tired signals fall toward seats on a brain cell. Caffeine holds ${blocked}% of the seats, so signals bounce off those and land in the rest.`,
  };
}

export const BrainInset = closeupInset(brainCloseup, { Drawing, paint: paintBrain, usePlate: useBrainPlate });
