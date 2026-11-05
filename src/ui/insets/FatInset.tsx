import { memo } from "react";
import { value } from "../../model/simulate";
import { clamp01, easeToward, lerp, parts, seededRandom, tenth } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { createStream, curve, Placer } from "./stream";

const CELLS = [
  { x: 54, y: 62, r: 25 }, { x: 108, y: 54, r: 24 }, { x: 36, y: 116, r: 24 }, { x: 88, y: 110, r: 27 }, { x: 142, y: 102, r: 24 }, { x: 62, y: 158, r: 22 }, { x: 118, y: 156, r: 24 },
];
const VESSEL = curve([[188, -4], [194, 60], [186, 120], [192, 184]]);
const STORING_ABOVE_REST_MG_DL = 8;
const FULLEST_OVER_MG_DL = 110;

// Between the vessel and one cell, in whichever direction fat is going.
function betweenVesselAndCell(storing: boolean): Placer {
  return (progress, seat) => {
    const cell = CELLS[Math.floor(seat * CELLS.length) % CELLS.length];
    const k = storing ? progress : 1 - progress;
    return { x: lerp(190, cell.x, k), y: lerp(20 + seat * 140, cell.y, k) };
  };
}

function createPainter(art: SVGSVGElement): Painter {
  const droplets = parts<SVGCircleElement>(art, "droplet");
  const fat = createStream(parts(art, "fat"), 3.4, 21);
  const toCell = betweenVesselAndCell(true);
  const fromCell = betweenVesselAndCell(false);
  const wobble = seededRandom(3);
  const seeds = CELLS.map(() => 0.88 + wobble() * 0.1);
  let fill = 0;
  return (frame, { trajectory, t }) => {
    const over = value(trajectory, "tg", t) - trajectory.anthro.baselineTg;
    const storing = over > STORING_ABOVE_REST_MG_DL;
    fat(frame, storing ? Math.min(4, 0.5 + over / 24) : 0.3, storing ? toCell : fromCell);
    const target = clamp01(over / FULLEST_OVER_MG_DL);
    fill = frame.still ? target : easeToward(fill, target, frame.dt, 1.5);
    droplets.forEach((el, i) => el.setAttribute("r", tenth(CELLS[i].r * seeds[i] * (0.74 + 0.14 * fill))));
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={VESSEL.d} />
      {CELLS.map((cell, i) => (
        <g key={i}>
          <circle className="line-soft" cx={cell.x} cy={cell.y} r={cell.r} />
          <circle data-part="droplet" className="fat-droplet" cx={cell.x} cy={cell.y} r={cell.r * 0.7} />
        </g>
      ))}
      {Array.from({ length: 16 }, (_, k) => <circle key={k} data-part="fat" className="flow-dot" r="1.5" />)}
      <text x="232" y="172" textAnchor="end">Your blood</text>
    </>
  );
});

export function FatInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const { trajectory: tr, t } = props;
  const over = value(tr, "tg", t) - tr.anthro.baselineTg;
  const stored = value(tr, "fatStoredG", t);
  const label = over > STORING_ABOVE_REST_MG_DL ? `Taking in fat: blood fat ${Math.round(over)} mg/dL over rest` : "Releasing a little fat for fuel";
  return (
    <Plate caption={label} note={stored >= 1 ? { text: `Stored today: ${Math.round(stored)} g` } : undefined} describe={`Fat cells beside a blood vessel, taking in meal fat or releasing it as fuel. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
