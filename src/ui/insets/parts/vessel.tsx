import { part, parts, pointAlong } from "../draw";
import { createStream, curve, Placer } from "../stream";
import { Part, setLit } from "./part";

const WALL = 1.2;
const RED_CELLS = { pool: 20, seconds: 5.2, perSecond: 3, rx: 2.6, ry: 1.6, lanes: 1.1 };

interface VesselOptions {
  id: string;
  points: [number, number][]; // in the direction the blood flows, left to right
  radius: number;
}

export interface Vessel extends Part<{ lit: number }> {
  centerAt: (x: number) => number; // where something leaving or entering the blood crosses at this x
}

// A blood vessel: a red tube with a wall, and red cells flowing along it. They flow in every figure,
// because blood never stops, and how much the vessel matters to a step is how lit it is.
export function vessel({ id, points, radius }: VesselOptions): Vessel {
  const { d, route } = curve(points, 96);
  return {
    Art: () => (
      <g data-part={id}>
        <path className="part-vessel-wall" d={d} strokeWidth={(radius + WALL) * 2} />
        <path className="part-vessel-blood" d={d} strokeWidth={radius * 2} />
        {Array.from({ length: RED_CELLS.pool }, (_, k) => (
          <ellipse key={k} data-part={`${id}-cell`} className="part-red-cell" rx={RED_CELLS.rx} ry={RED_CELLS.ry} />
        ))}
      </g>
    ),
    attach: (art) => {
      const group = part<SVGGElement>(art, id);
      const cells = createStream(parts(group, `${id}-cell`), RED_CELLS.seconds, 23);
      const flowing: Placer = (progress, seat) => {
        const at = pointAlong(route, progress);
        return { x: at.x, y: at.y + (seat - 0.5) * radius * RED_CELLS.lanes };
      };
      return (frame, { lit }) => {
        setLit(group, lit);
        cells(frame, RED_CELLS.perSecond, flowing);
      };
    },
    centerAt: (x) => (route.points.find((p) => p.x >= x) ?? route.points[route.points.length - 1]).y,
  };
}
