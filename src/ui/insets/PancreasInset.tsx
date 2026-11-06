import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { pancreasCloseup } from "../../closeup/pancreas";
import { INSULIN, REFERENCE } from "../../model/params";
import { value } from "../../model/simulate";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, pointAlong, smoothstep, tenth } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit, setShown, setWord } from "./parts/part";
import { Tag } from "./parts/Tag";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";
import { createStream, Placer } from "./stream";

type Setting = (typeof pancreasCloseup.keys)[number];

const CELL_RADIUS = 11.5;
const ROW_STEP = 19.2;
const COLUMN_STEP = 22.2;
const CLUSTER = { x: 86, y: 90 };
const ROWS = [3, 4, 5, 4, 3];

const CELLS = ROWS.flatMap((count, row) =>
  Array.from({ length: count }, (_, i) => ({
    x: CLUSTER.x + (i - (count - 1) / 2) * COLUMN_STEP,
    y: CLUSTER.y + (row - (ROWS.length - 1) / 2) * ROW_STEP,
  })),
);

const hexagon = (x: number, y: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    return `${i ? "L" : "M"}${tenth(x + Math.cos(a) * CELL_RADIUS)} ${tenth(y + Math.sin(a) * CELL_RADIUS)}`;
  }).join("") + "Z";

const BLOOD = vessel({ id: "blood", radius: 6, points: [[200, -10], [204, 50], [196, 120], [200, 190]] });

const INSULIN_DOTS = { pool: 26, seconds: 3.4, restingPerSecond: 0.28, mostPerSecond: 6.5, crossingShare: 0.46 };
const SUGAR_DOTS = { pool: 14, seconds: 3, mostPerSecond: 4.5 };
const GLOW = { most: 0.35, speed: 1.4 };

function paintPancreas(art: SVGSVGElement) {
  const insulin = createStream(parts(art, "dot"), INSULIN_DOTS.seconds, 11);
  const sugar = createStream(parts(art, "sugar"), SUGAR_DOTS.seconds, 5);
  const glows = parts<SVGPathElement>(art, "glow");
  const insulinParts = part<SVGGElement>(art, "insulin");
  const sugarParts = part<SVGGElement>(art, "sugars");
  const sugarTag = part<SVGTextElement>(art, "sugar-tag");
  const paintBlood = BLOOD.attach(art);

  // Out of one cell, across to the vessel, and away down it.
  const released: Placer = (progress, seat) => {
    const origin = CELLS[Math.floor(seat * CELLS.length) % CELLS.length];
    const entry = lerp(0.2, 0.75, (seat * 7) % 1);
    if (progress >= INSULIN_DOTS.crossingShare) return pointAlong(BLOOD.route, lerp(entry, 1, (progress - INSULIN_DOTS.crossingShare) / (1 - INSULIN_DOTS.crossingShare)));
    const at = pointAlong(BLOOD.route, entry);
    const crossing = smoothstep(0, 1, progress / INSULIN_DOTS.crossingShare);
    return { x: lerp(origin.x, at.x, crossing), y: lerp(origin.y, at.y, crossing) };
  };
  const inTheBlood: Placer = (progress) => pointAlong(BLOOD.route, progress);

  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    insulin(frame, lerp(INSULIN_DOTS.restingPerSecond, INSULIN_DOTS.mostPerSecond, levels.insulin), released);
    sugar(frame, levels.sugar * SUGAR_DOTS.mostPerSecond, inTheBlood);
    // Cells working harder glow more, each on its own beat.
    const glowing = levels.insulin * GLOW.most;
    glows.forEach((glow, i) => setShown(glow, glowing * (frame.still ? 0.5 : 0.5 + 0.5 * Math.sin(frame.clock * GLOW.speed + i * 2.4))));
    setLit(insulinParts, lit.insulin);
    setLit(sugarParts, lit.sugar);
    setWord(sugarTag, levels.sugar * 6, lit.sugar);
    paintBlood(frame, { lit: Math.max(levels.sugar * lit.sugar, levels.insulin * lit.insulin) * 3 });
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <BLOOD.Art />
      <g data-part="sugars">
        {Array.from({ length: SUGAR_DOTS.pool }, (_, k) => (
          <circle key={k} data-part="sugar" className="flow-dot-food" r="1.9" />
        ))}
      </g>
      <g data-part="insulin">
        {CELLS.map((cell, i) => (
          <g key={i}>
            <path className="islet-cell" d={hexagon(cell.x, cell.y)} />
            <path data-part="glow" className="islet-glow" style={{ opacity: 0 }} d={hexagon(cell.x, cell.y)} />
            <circle className="islet-nucleus" cx={cell.x} cy={cell.y} r="2" />
          </g>
        ))}
        {Array.from({ length: INSULIN_DOTS.pool }, (_, k) => (
          <circle key={k} data-part="dot" className="insulin-dot" r="1.7" />
        ))}
        <text x={CLUSTER.x} y={CLUSTER.y + 58} textAnchor="middle">Cells that make insulin</text>
        <text x="188" y="172" textAnchor="end">Into your blood</text>
      </g>
      <Tag part="sugar-tag" x={188} y={24} anchor="end">Sugar in your blood</Tag>
    </>
  );
});

function usePancreasPlate({ trajectory, t }: InsetProps, _levels: Levels<Setting>): PlateWords {
  const fold = value(trajectory, "insulin", t) / INSULIN.baselineUUPerMl;
  const caption = fold < REFERENCE.insulin.atRestBelowFold ? "Insulin: at its resting level" : `Insulin: ${fold.toFixed(1)}× resting`;
  return { caption, describe: `A cluster of islet cells releasing insulin into a blood vessel. ${caption}.` };
}

export const PancreasInset = closeupInset(pancreasCloseup, { Drawing, paint: paintPancreas, usePlate: usePancreasPlate, captionFromModel: true });
