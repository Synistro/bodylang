import { part, parts, pointAlong, Polyline } from "../draw";
import { createStream, curve, Placer } from "../stream";
import { Part, setLit } from "./part";

const WALL = 1.2;
const RED_CELLS = { pool: 20, seconds: 5.2, perSecond: 3, rx: 2.6, ry: 1.6, lanes: 1.1 };
const LOOK_AHEAD = 0.01; // of the route, to find which way it is heading

interface VesselOptions {
  id: string;
  points: [number, number][]; // in the direction it flows
  radius: number;
  tone?: "blood" | "lymph";
}

export interface Vessel extends Part<{ lit: number; until?: number }> {
  route: Polyline; // for whatever else travels inside it
  centerAt: (x: number) => number; // where something leaving or entering crosses at this x, on a vessel running sideways
}

// A vessel: a tube with a wall. Blood carries red cells, and they flow in every close-up, because blood
// never stops. How much the vessel matters to a step is how lit it is.
export function vessel({ id, points, radius, tone = "blood" }: VesselOptions): Vessel {
  const { d, route } = curve(points, 96);
  const redCells = tone === "blood" ? RED_CELLS.pool : 0;
  return {
    Art: () => (
      <g data-part={id} data-tone={tone}>
        <path className="part-vessel-wall" d={d} strokeWidth={(radius + WALL) * 2} />
        <path className="part-vessel-inside" d={d} strokeWidth={radius * 2} />
        {Array.from({ length: redCells }, (_, k) => (
          <ellipse key={k} data-part={`${id}-cell`} className="part-red-cell" rx={RED_CELLS.rx} ry={RED_CELLS.ry} />
        ))}
      </g>
    ),
    attach: (art) => {
      const group = part<SVGGElement>(art, id);
      const cells = createStream(parts(group, `${id}-cell`), RED_CELLS.seconds, 23);
      let until = 1; // how far along the cells get, for a vessel with something in the way
      const flowing: Placer = (progress, seat) => {
        const at = pointAlong(route, progress * until);
        const ahead = pointAlong(route, Math.min(1, progress * until + LOOK_AHEAD));
        const dx = ahead.x - at.x;
        const dy = ahead.y - at.y;
        const length = Math.hypot(dx, dy) || 1;
        const off = (seat - 0.5) * radius * RED_CELLS.lanes;
        return { x: at.x - (dy / length) * off, y: at.y + (dx / length) * off };
      };
      return (frame, input) => {
        until = input.until ?? 1;
        setLit(group, input.lit);
        if (redCells) cells(frame, RED_CELLS.perSecond, flowing);
      };
    },
    route,
    centerAt: (x) => (route.points.find((p) => p.x >= x) ?? route.points[route.points.length - 1]).y,
  };
}
