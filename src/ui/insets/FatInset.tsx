import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { FAT_OVER, fatCloseup } from "../../closeup/fat";
import { value } from "../../model/simulate";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, seededRandom, tenth } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";
import { createStream, Placer } from "./stream";

type Setting = (typeof fatCloseup.keys)[number];

const CELLS = [
  { x: 54, y: 62, r: 25 }, { x: 108, y: 54, r: 24 }, { x: 36, y: 116, r: 24 }, { x: 88, y: 110, r: 27 }, { x: 142, y: 102, r: 24 }, { x: 62, y: 158, r: 22 }, { x: 118, y: 156, r: 24 },
];
const BLOOD = vessel({ id: "blood", radius: 5, points: [[188, -4], [194, 60], [186, 120], [192, 184]] });
const RELEASING_MOST_PER_SECOND = 1.2;

// Between the vessel and one cell, in whichever direction fat is going.
function betweenVesselAndCell(storing: boolean): Placer {
  return (progress, seat) => {
    const cell = CELLS[Math.floor(seat * CELLS.length) % CELLS.length];
    const k = storing ? progress : 1 - progress;
    return { x: lerp(190, cell.x, k), y: lerp(20 + seat * 140, cell.y, k) };
  };
}

function paintFat(art: SVGSVGElement) {
  const droplets = parts<SVGCircleElement>(art, "droplet");
  const going = createStream(parts(art, "fat-in"), 3.4, 21);
  const leaving = createStream(parts(art, "fat-out"), 3.4, 27);
  const toCell = betweenVesselAndCell(true);
  const fromCell = betweenVesselAndCell(false);
  const paintBlood = BLOOD.attach(art);
  const takingIn = parts<SVGGElement>(art, "taking-in");
  const releasing = part<SVGGElement>(art, "releasing");
  const wobble = seededRandom(3);
  const seeds = CELLS.map(() => 0.88 + wobble() * 0.1);
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    const over = levels.taking_in * FAT_OVER.full;
    going(frame, over > FAT_OVER.storingFrom ? Math.min(4, 0.5 + over / 24) : 0, toCell);
    leaving(frame, levels.releasing * RELEASING_MOST_PER_SECOND, fromCell);
    droplets.forEach((el, i) => el.setAttribute("r", tenth(CELLS[i].r * seeds[i] * (0.74 + 0.14 * levels.taking_in))));
    for (const group of takingIn) setLit(group, lit.taking_in);
    setLit(releasing, lit.releasing);
    paintBlood(frame, { lit: Math.max(levels.taking_in * lit.taking_in, levels.releasing * lit.releasing) * 3 });
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <BLOOD.Art />
      {CELLS.map((cell, i) => (
        <g key={i}>
          <circle className="line-soft" cx={cell.x} cy={cell.y} r={cell.r} />
          <g data-part="taking-in">
            <circle data-part="droplet" className="fat-droplet" cx={cell.x} cy={cell.y} r={cell.r * 0.7} />
          </g>
        </g>
      ))}
      <g data-part="taking-in">{Array.from({ length: 16 }, (_, k) => <circle key={k} data-part="fat-in" className="flow-dot" r="1.5" />)}</g>
      <g data-part="releasing">{Array.from({ length: 6 }, (_, k) => <circle key={k} data-part="fat-out" className="flow-dot" r="1.5" />)}</g>
      <text x="232" y="172" textAnchor="end">Your blood</text>
    </>
  );
});

function useFatPlate({ trajectory: tr, t }: InsetProps, levels: Levels<Setting>): PlateWords {
  // The droplets stop at their fullest, and blood fat can go past that after a very fatty meal.
  const over = levels.taking_in < 1 ? levels.taking_in * FAT_OVER.full : Math.max(FAT_OVER.full, value(tr, "tg", t) - tr.anthro.baselineTg);
  const stored = value(tr, "fatStoredG", t);
  const caption = over > FAT_OVER.storingFrom ? `Taking in fat: blood fat ${Math.round(over)} mg/dL over rest` : "Releasing a little fat for fuel";
  return { caption, note: stored >= 1 ? { text: `Stored today: ${Math.round(stored)} g` } : undefined, describe: `Fat cells beside a blood vessel, taking in meal fat or releasing it as fuel. ${caption}.` };
}

export const FatInset = closeupInset(fatCloseup, { Drawing, paint: paintFat, usePlate: useFatPlate });
