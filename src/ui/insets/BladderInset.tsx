import { memo } from "react";
import { REFERENCE } from "../../model/params";
import { value } from "../../model/simulate";
import { clamp01, easeToward, lerp, part, parts, tenth } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { along, createStream, curve } from "./stream";

const CENTER = { x: 128, y: 94 };
const SIZE = { emptyX: 34, fullX: 62, emptyY: 22, fullY: 52 };
const URETER_L = curve([[100, -4], [98, 20], [108, 48]]);
const URETER_R = curve([[156, -4], [158, 20], [148, 48]]);
const WAVE_POINTS = 24;

const shareOf = (ml: number) => clamp01(ml / REFERENCE.bladder.capacityMl);

function createPainter(art: SVGSVGElement): Painter {
  const wall = part<SVGEllipseElement>(art, "wall");
  const clip = part<SVGEllipseElement>(art, "clip");
  const water = part<SVGPathElement>(art, "water");
  const left = createStream(parts(art, "drop-left"), 2.4, 3);
  const right = createStream(parts(art, "drop-right"), 2.4, 4);
  let share = 0;
  return (frame, { trajectory, t }) => {
    const ml = value(trajectory, "bladderMl", t);
    share = frame.still ? shareOf(ml) : easeToward(share, shareOf(ml), frame.dt, 3);
    // It stretches as it fills, and the water is always most of what is in there.
    const rx = lerp(SIZE.emptyX, SIZE.fullX, Math.sqrt(share));
    const ry = lerp(SIZE.emptyY, SIZE.fullY, Math.sqrt(share));
    const bottom = CENTER.y + ry;
    for (const el of [wall, clip]) {
      el.setAttribute("rx", tenth(rx));
      el.setAttribute("ry", tenth(ry));
    }
    const level = bottom - ry * 2 * Math.min(0.92, 0.3 + share * 0.9);
    let d = "";
    for (let i = 0; i <= WAVE_POINTS; i++) {
      const x = CENTER.x - rx + (i / WAVE_POINTS) * rx * 2;
      const y = level + Math.sin(i * 0.7 + (frame.still ? 0 : frame.clock * 1.6)) * 0.8;
      d += `${i ? "L" : "M"}${tenth(x)} ${tenth(y)}`;
    }
    water.setAttribute("d", `${d}L${tenth(CENTER.x + rx)} ${tenth(bottom)}L${tenth(CENTER.x - rx)} ${tenth(bottom)}Z`);
    const perSecond = Math.max(0.15, Math.min(1.6, (value(trajectory, "bladderMl", t + 1) - value(trajectory, "bladderMl", t)) * 0.5));
    left(frame, perSecond, along(URETER_L.route));
    right(frame, perSecond, along(URETER_R.route));
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <defs>
        <clipPath id="bladder-inside">
          <ellipse data-part="clip" cx={CENTER.x} cy={CENTER.y} rx={SIZE.emptyX} ry={SIZE.emptyY} />
        </clipPath>
      </defs>
      <path className="line-soft" d={URETER_L.d} />
      <path className="line-soft" d={URETER_R.d} />
      <g clipPath="url(#bladder-inside)">
        <path data-part="water" className="bladder-water" />
      </g>
      <ellipse data-part="wall" className="line-ink" cx={CENTER.x} cy={CENTER.y} rx={SIZE.emptyX} ry={SIZE.emptyY} />
      <path className="line-soft" d={`M${CENTER.x - 4} 150V182M${CENTER.x + 4} 150V182`} />
      <path className="line-ink" d={`M${CENTER.x - 8} 152H${CENTER.x + 8}`} />
      {Array.from({ length: 5 }, (_, k) => <circle key={k} data-part="drop-left" className="flow-dot" r="1.6" />)}
      {Array.from({ length: 5 }, (_, k) => <circle key={k} data-part="drop-right" className="flow-dot" r="1.6" />)}
      <text x="166" y="14">From the kidneys</text>
      <text x={CENTER.x + 14} y="165">Held shut until you go</text>
    </>
  );
});

export function BladderInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const ml = value(props.trajectory, "bladderMl", props.t);
  const r = REFERENCE.bladder;
  const label = `Bladder: ${Math.round(ml / 10) * 10} ml`;
  const note = ml >= r.strongDesireMl ? "You need to go soon" : ml >= r.firstDesireMl ? "You may start to notice it" : undefined;
  return (
    <Plate caption={label} note={note ? { text: note } : undefined} describe={`The bladder filling from the two ureters and stretching as it fills. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
