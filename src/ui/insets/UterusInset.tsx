import { memo } from "react";
import { cycleDay, cyclePhase, hormonesAt, liningShare, minutesToNextPeriod } from "../../model/cycle";
import { CYCLE } from "../../model/params";
import { clamp01, easeToward, lerp, part, parts, pointAlong, tenth } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { createStream, curve, Placer } from "./stream";

const WALL = "M72 58C72 42 88 34 120 34C152 34 168 42 168 58C168 88 148 112 134 128L132 150C132 156 108 156 108 150L106 128C92 112 72 88 72 58Z";
const CAVITY = "M92 60C92 54 104 52 120 52C136 52 148 54 148 60C148 78 132 100 120 118C108 100 92 78 92 60Z";
const TUBES = "M72 54C50 44 36 48 18 38M168 54C190 44 204 48 222 38";
const CERVIX = { x: 120, top: 118, bottom: 180 };
const ARTERY_L = curve([[-4, 112], [30, 98], [72, 76]]);
const ARTERY_R = curve([[244, 112], [210, 98], [168, 76]]);
const LINING_WIDEST = 13; // in figure units
const LINING_NARROWEST = 2;

function createPainter(art: SVGSVGElement): Painter {
  const lining = part<SVGPathElement>(art, "lining");
  const drops = createStream(parts(art, "drop"), 3.2, 17);
  const hormones = createStream(parts(art, "hormone"), 3, 31);
  // Hormones arrive in the blood from either side, and reach the lining.
  const arriving: Placer = (progress, seat) => {
    const left = seat < 0.5;
    const route = left ? ARTERY_L.route : ARTERY_R.route;
    if (progress < 0.7) return pointAlong(route, progress / 0.7);
    const at = pointAlong(route, 1);
    const k = (progress - 0.7) / 0.3;
    return { x: lerp(at.x, left ? 96 : 144, k), y: lerp(at.y, 72, k) };
  };
  let share = 0;
  return (frame, { trajectory, t }) => {
    const { cycle } = trajectory;
    const target = cycle ? liningShare(cycle, t) : CYCLE.lining.least;
    share = frame.still ? target : easeToward(share, target, frame.dt, 1.2);
    lining.style.strokeWidth = `${tenth(lerp(LINING_NARROWEST, LINING_WIDEST, clamp01(share)))}`;
    const shedding = cycle !== null && cyclePhase(cycle, t) === "period";
    drops(frame, shedding ? 1.6 : 0, (k, seat) => ({ x: CERVIX.x + (seat - 0.5) * 6, y: lerp(CERVIX.top - 22, CERVIX.bottom, k) }));
    const made = cycle ? hormonesAt(cycle, t) : null;
    hormones(frame, made ? Math.min(3, made.estradiol / 400 + made.progesterone / 16) : 0.2, arriving);
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={TUBES} />
      <path className="line-hair" d={ARTERY_L.d} />
      <path className="line-hair" d={ARTERY_R.d} />
      <path className="line-ink" d={WALL} />
      <path data-part="lining" className="uterus-lining" d={CAVITY} />
      <path className="line-soft" d={CAVITY} />
      {Array.from({ length: 8 }, (_, k) => <circle key={k} data-part="drop" className="flow-dot" r="1.7" />)}
      {Array.from({ length: 10 }, (_, k) => <circle key={k} data-part="hormone" className="flow-dot-quiet" r="1.3" />)}
      <text x="176" y="130">The lining</text>
      <path className="leader" d="M180 123L140 88" />
      <text x="232" y="96" textAnchor="end">Hormones arrive</text>
    </>
  );
});

export function UterusInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const { cycle } = props.trajectory;
  const phase = cycle ? cyclePhase(cycle, props.t) : null;
  const doing = phase === "period" ? "lining shedding" : phase === "luteal" ? "lining ready" : "lining rebuilding";
  const label = cycle ? `Day ${cycleDay(cycle, props.t)}: ${doing}` : "No cycle logged";
  const days = cycle ? Math.round(minutesToNextPeriod(cycle, props.t) / 1440) : null;
  return (
    <Plate caption={label} note={days !== null ? { text: `Next period in about ${days} ${days === 1 ? "day" : "days"}` } : undefined} describe={`The uterus and its lining, which thickens through a cycle and sheds in a period. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
