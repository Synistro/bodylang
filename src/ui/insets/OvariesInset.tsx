import { memo } from "react";
import { cyclePhase, daysIntoCycle, hormonesAt } from "../../model/cycle";
import { CYCLE } from "../../model/params";
import { clamp01, easeToward, lerp, part, parts, pointAlong, tenth } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { createStream, curve, Placer } from "./stream";

const OVARY = { x: 92, y: 100, rx: 66, ry: 46 };
const FOLLICLE = { x: 128, y: 92 };
const RESTING = [{ x: 58, y: 84, r: 5 }, { x: 72, y: 118, r: 6 }, { x: 96, y: 72, r: 4.5 }, { x: 100, y: 128, r: 5 }, { x: 48, y: 108, r: 4 }];
const TUBE = curve([[154, 74], [176, 62], [202, 62], [244, 44]]);
const VESSEL = curve([[-4, 164], [120, 160], [244, 164]]);

function createPainter(art: SVGSVGElement): Painter {
  const follicle = part<SVGCircleElement>(art, "follicle");
  const luteum = part<SVGCircleElement>(art, "luteum");
  const egg = part<SVGCircleElement>(art, "egg");
  const hormone = createStream(parts(art, "hormone"), 3.6, 19);
  const toBlood: Placer = (progress, seat) => {
    const entry = 0.3 + seat * 0.3;
    if (progress < 0.5) {
      const end = pointAlong(VESSEL.route, entry);
      const k = progress / 0.5;
      return { x: lerp(FOLLICLE.x, end.x, k), y: lerp(FOLLICLE.y + 8, end.y, k) };
    }
    return pointAlong(VESSEL.route, entry + ((progress - 0.5) / 0.5) * (1 - entry));
  };
  let grown = 0;
  let spent = 0;
  return (frame, { trajectory, t }) => {
    const { cycle } = trajectory;
    const day = cycle ? daysIntoCycle(cycle, t) : 0;
    const ovulation = cycle ? cycle.lengthDays - CYCLE.lutealDays : 14;
    const phase = cycle ? cyclePhase(cycle, t) : null;
    const growing = cycle ? clamp01(day / ovulation) : 0;
    const after = cycle ? clamp01((day - ovulation) / 3) : 0;
    grown = frame.still ? growing : easeToward(grown, growing, frame.dt, 2.5);
    spent = frame.still ? after : easeToward(spent, after, frame.dt, 2.5);
    follicle.setAttribute("r", tenth(lerp(5, 24, grown) * (1 - spent)));
    follicle.style.opacity = spent > 0.96 ? "0" : "1";
    luteum.setAttribute("r", tenth(16 * spent));
    // The egg leaves along the tube around ovulation, and is gone after.
    const leaving = cycle ? clamp01((day - ovulation + 1) / 2) : 0;
    if (cycle && phase === "ovulation") {
      const at = pointAlong(TUBE.route, leaving);
      egg.setAttribute("cx", tenth(at.x));
      egg.setAttribute("cy", tenth(at.y));
      egg.style.visibility = "visible";
    } else egg.style.visibility = "hidden";
    const made = cycle ? hormonesAt(cycle, t) : null;
    hormone(frame, made ? Math.min(4.5, made.estradiol / 280 + made.progesterone / 12) : 0.25, toBlood);
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={TUBE.d} />
      <path className="line-hair" d={VESSEL.d} />
      <ellipse className="line-ink" cx={OVARY.x} cy={OVARY.y} rx={OVARY.rx} ry={OVARY.ry} />
      {RESTING.map((f) => <circle key={f.x} className="line-soft" cx={f.x} cy={f.y} r={f.r} />)}
      <circle data-part="follicle" className="ovary-follicle" cx={FOLLICLE.x} cy={FOLLICLE.y} r="5" />
      <circle data-part="luteum" className="ovary-luteum" cx={FOLLICLE.x} cy={FOLLICLE.y} r="0" />
      <circle data-part="egg" className="flow-dot-food" r="3.4" style={{ visibility: "hidden" }} />
      {Array.from({ length: 16 }, (_, k) => <circle key={k} data-part="hormone" className="flow-dot" r="1.4" />)}
      <text x="232" y="36" textAnchor="end">The tube, to the uterus</text>
      <text x="232" y="176" textAnchor="end">Hormones into your blood</text>
    </>
  );
});

export function OvariesInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const { cycle } = props.trajectory;
  if (!cycle) {
    return (
      <Plate caption="No cycle logged" describe="An ovary, with follicles at rest." artRef={art}>
        <Drawing />
      </Plate>
    );
  }
  const phase = cyclePhase(cycle, props.t);
  const made = hormonesAt(cycle, props.t);
  const label = phase === "luteal" ? `Progesterone: ${made.progesterone.toFixed(1)} nmol/L` : `Estrogen: ${Math.round(made.estradiol)} pmol/L`;
  const note = phase === "ovulation" ? "An egg leaves about now" : phase === "luteal" ? "The empty follicle makes this" : "A follicle is growing";
  return (
    <Plate caption={label} note={{ text: note }} describe={`An ovary. A follicle grows through the first half of a cycle, releases an egg, and then makes progesterone. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
