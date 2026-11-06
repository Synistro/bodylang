import { part, parts, pointAlong, polyline, Polyline } from "../draw";
import { createStream, curve, Placer } from "../stream";
import { Part, setLit } from "./part";

const PULSES = { pool: 10, seconds: 3.5, most: 3, r: 2 };

interface NerveOptions {
  id: string;
  points: [number, number][]; // towards the brain, left to right
  endings: { x: number; tip: [number, number] }[]; // each joins the nerve at x and reaches into the tissue
}

// A nerve: a yellow line whose endings reach into the tissue. A signal starts at an ending and runs along
// the nerve towards the brain, so more signal is more pulses.
export function nerve({ id, points, endings }: NerveOptions): Part<{ signal: number }> {
  const main = curve(points, 96);
  const branches = endings.map(({ x, tip }) => {
    const joins = main.route.points.findIndex((p) => p.x >= x);
    const join = main.route.points[joins];
    const branch = curve([tip, [(tip[0] + join.x) / 2 - 3, (tip[1] + join.y) / 2 + 2], [join.x, join.y]], 12);
    const route: Polyline = polyline([...branch.route.points, ...main.route.points.slice(joins + 1)]);
    return { d: branch.d, tip, route };
  });
  return {
    Art: () => (
      <g data-part={id}>
        <g data-part={`${id}-line`}>
          <path className="part-nerve" d={main.d} />
          {branches.map(({ d, tip }) => (
            <g key={d}>
              <path className="part-nerve" d={d} />
              <circle className="part-nerve-ending" cx={tip[0]} cy={tip[1]} r="1.4" />
            </g>
          ))}
        </g>
        {Array.from({ length: PULSES.pool }, (_, k) => (
          <circle key={k} data-part={`${id}-pulse`} className="part-nerve-pulse" r={PULSES.r} />
        ))}
      </g>
    ),
    attach: (art) => {
      const group = part<SVGGElement>(art, id);
      const line = part<SVGGElement>(group, `${id}-line`);
      const pulses = createStream(parts(group, `${id}-pulse`), PULSES.seconds, 13);
      const running: Placer = (progress, seat) =>
        pointAlong(
          branches.length ? branches[Math.floor(seat * branches.length) % branches.length].route : main.route,
          progress,
        );
      return (frame, { signal }) => {
        setLit(line, signal);
        pulses(frame, signal * PULSES.most, running);
      };
    },
  };
}
