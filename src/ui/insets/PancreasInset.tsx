import { memo } from "react";
import { INSULIN, REFERENCE } from "../../model/params";
import { value } from "../../model/simulate";
import { easeToward, lerp, parts, pointAlong, polyline, tenth, sampleTube, seededRandom, smoothstep } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { ART_HEIGHT, Plate } from "./Plate";

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

const VESSEL = sampleTube(
  [
    { x: 200, y: -6, r: 6 },
    { x: 204, y: 50, r: 6 },
    { x: 196, y: 120, r: 6 },
    { x: 200, y: 186, r: 6 },
  ],
  30,
);
const VESSEL_ROUTE = polyline(VESSEL);
const vesselWall = (sign: number) => VESSEL.map((p, i) => `${i ? "L" : "M"}${tenth(p.x + p.nx * p.r * sign)} ${tenth(p.y + p.ny * p.r * sign)}`).join("");

const DOT_POOL = 26;
const DOT_SECONDS = 3.4;
const CROSSING_SHARE = 0.46; // the part of a dot's life spent crossing to the vessel
const RESTING_DOTS_PER_SECOND = 0.28;
const DOTS_PER_SECOND_PER_SECRETION = 1.5;
const MAX_DOTS_PER_SECOND = 6.5;
const STILL_CLOCK = 11;

function createPancreasPainter(art: SVGSVGElement): Painter {
  const dots = parts<SVGCircleElement>(art, "dot");
  const glows = parts<SVGPathElement>(art, "glow");
  const random = seededRandom(11);
  const born = new Float32Array(DOT_POOL).fill(-Infinity);
  const fromCell = new Uint8Array(DOT_POOL);
  const entryY = new Float32Array(DOT_POOL);
  const glow = new Float32Array(CELLS.length);
  let next = 0;
  let due = 0;

  return ({ dt, clock, still }, { trajectory, t }) => {
    const perSecond = Math.min(MAX_DOTS_PER_SECOND, RESTING_DOTS_PER_SECOND + value(trajectory, "insulinSecretion", t) * DOTS_PER_SECOND_PER_SECRETION);
    const now = still ? STILL_CLOCK : clock;
    if (still) {
      // A still shows the dots that would be in flight at this rate.
      const inFlight = Math.min(DOT_POOL, Math.round(perSecond * DOT_SECONDS));
      for (let k = 0; k < DOT_POOL; k++) {
        born[k] = k < inFlight ? now - ((k + 0.5) / inFlight) * DOT_SECONDS : -Infinity;
        fromCell[k] = k % CELLS.length;
        entryY[k] = lerp(30, 150, ((k * 7) % DOT_POOL) / DOT_POOL);
      }
    } else {
      due += dt * perSecond;
      while (due >= 1) {
        due -= 1;
        const cell = Math.floor(random() * CELLS.length);
        born[next] = now;
        fromCell[next] = cell;
        entryY[next] = lerp(30, 150, random());
        glow[cell] = 1;
        next = (next + 1) % DOT_POOL;
      }
    }
    for (let k = 0; k < DOT_POOL; k++) {
      const age = now - born[k];
      if (age > DOT_SECONDS) {
        dots[k].style.visibility = "hidden";
        continue;
      }
      const progress = age / DOT_SECONDS;
      const origin = CELLS[fromCell[k]];
      let position: { x: number; y: number };
      if (progress < CROSSING_SHARE) {
        const crossing = smoothstep(0, 1, progress / CROSSING_SHARE);
        const entry = pointAlong(VESSEL_ROUTE, entryY[k] / ART_HEIGHT);
        position = { x: lerp(origin.x, entry.x, crossing), y: lerp(origin.y, entry.y, crossing) };
      } else {
        position = pointAlong(VESSEL_ROUTE, lerp(entryY[k] / ART_HEIGHT, 1, (progress - CROSSING_SHARE) / (1 - CROSSING_SHARE)));
      }
      dots[k].setAttribute("cx", tenth(position.x));
      dots[k].setAttribute("cy", tenth(position.y));
      dots[k].style.visibility = "visible";
    }
    glows.forEach((element, i) => {
      glow[i] = easeToward(glow[i], 0, dt, 2.4);
      element.style.opacity = String(Math.round(glow[i] * 35) / 100);
    });
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={`${vesselWall(1)}${vesselWall(-1)}`} />
      {CELLS.map((cell, i) => (
        <g key={i}>
          <path className="islet-cell" d={hexagon(cell.x, cell.y)} />
          <path data-part="glow" className="islet-glow" style={{ opacity: 0 }} d={hexagon(cell.x, cell.y)} />
          <circle className="islet-nucleus" cx={cell.x} cy={cell.y} r="2" />
        </g>
      ))}
      {Array.from({ length: DOT_POOL }, (_, k) => (
        <circle key={k} data-part="dot" className="insulin-dot" r="1.7" />
      ))}
      <text x={CLUSTER.x} y={CLUSTER.y + 58} textAnchor="middle">Cells that make insulin</text>
      <text x="188" y="172" textAnchor="end">Into your blood</text>
    </>
  );
});

export function PancreasInset(props: InsetProps) {
  const art = useInsetPainter(createPancreasPainter, props);
  const fold = value(props.trajectory, "insulin", props.t) / INSULIN.baselineUUPerMl;
  const label = fold < REFERENCE.insulin.atRestBelowFold ? "Insulin: at its resting level" : `Insulin: ${fold.toFixed(1)}× resting`;
  return (
    <Plate caption={label} describe={`A cluster of islet cells releasing insulin into a blood vessel. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
