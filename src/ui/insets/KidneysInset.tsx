import { memo } from "react";
import { BLOOD_FLOW, REFERENCE } from "../../model/params";
import { Trajectory, value } from "../../model/simulate";
import { lerp, parts, pointAlong } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { along, createStream, curve } from "./stream";

const IN = curve([[-4, 48], [36, 48], [62, 58], [74, 62]]);
const OUT = curve([[74, 62], [98, 40], [150, 34], [244, 34]]);
const CAPSULE = { x: 74, y: 62, r: 20 };
const TUBULE = curve([[88, 76], [108, 70], [120, 86], [138, 76], [150, 92], [150, 146], [160, 156], [172, 146], [172, 92], [186, 78], [200, 84], [206, 110], [206, 184]], 90);
const BACK_FROM_TUBULE = 0.46; // how far along the tubule the water that returns gets
const BACK_TO = { x: 150, y: 34 };

const urinePerMin = (tr: Trajectory, t: number) => Math.max(0, value(tr, "bladderMl", t + 1) - value(tr, "bladderMl", t));

function createPainter(art: SVGSVGElement): Painter {
  const blood = createStream(parts(art, "blood"), 2.6, 5);
  const filtered = createStream(parts(art, "filtered"), 4.2, 8);
  const urine = createStream(parts(art, "urine"), 7, 13);
  const bloodRoute = (progress: number) => (progress < 0.34 ? pointAlong(IN.route, progress / 0.34) : pointAlong(OUT.route, (progress - 0.34) / 0.66));
  const backRoute = (progress: number) => {
    if (progress < 0.72) return pointAlong(TUBULE.route, (progress / 0.72) * BACK_FROM_TUBULE);
    const from = pointAlong(TUBULE.route, BACK_FROM_TUBULE);
    const k = (progress - 0.72) / 0.28;
    return { x: lerp(from.x, BACK_TO.x, k), y: lerp(from.y, BACK_TO.y, k) };
  };
  return (frame, { trajectory, t }) => {
    const flow = value(trajectory, "flowKidneys", t) / BLOOD_FLOW.rest.kidneys;
    blood(frame, 3.2 * flow, bloodRoute);
    filtered(frame, 1.6 * flow, backRoute);
    urine(frame, Math.max(0.12, Math.min(3, urinePerMin(trajectory, t) * 0.7)), along(TUBULE.route));
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={IN.d} />
      <path className="line-soft" d={OUT.d} />
      <circle className="line-ink" cx={CAPSULE.x} cy={CAPSULE.y} r={CAPSULE.r} />
      {[[-4, -3], [4, -5], [6, 3], [-3, 5], [0, 0]].map(([x, y]) => (
        <circle key={`${x}${y}`} className="filter-tuft" cx={CAPSULE.x + x} cy={CAPSULE.y + y} r="4.2" />
      ))}
      <path className="tube-wall" d={TUBULE.d} />
      <path className="tube-bore" d={TUBULE.d} />
      {Array.from({ length: 10 }, (_, k) => <circle key={k} data-part="blood" className="flow-dot-quiet" r="1.5" />)}
      {Array.from({ length: 10 }, (_, k) => <circle key={k} data-part="filtered" className="flow-dot-quiet" r="1.3" />)}
      {Array.from({ length: 22 }, (_, k) => <circle key={k} data-part="urine" className="flow-dot" r="1.7" />)}
      <text x={CAPSULE.x} y={CAPSULE.y + 32} textAnchor="middle">The filter</text>
      <text x="142" y="124" textAnchor="end">Most water</text>
      <text x="142" y="133" textAnchor="end">goes back</text>
      <text x="198" y="172" textAnchor="end">To your bladder</text>
    </>
  );
});

export function KidneysInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const { trajectory: tr, t } = props;
  const dry = value(tr, "fluidBalance", t) <= -tr.scenario.body.weightKg * REFERENCE.fluid.noticeableShareOfWeight * 1000;
  const rate = urinePerMin(tr, t);
  const label = `Making ${rate.toFixed(1)} ml of urine a minute`;
  return (
    <Plate caption={label} note={dry ? { text: "Holding on to water" } : undefined} describe={`One of the kidney's filters. Blood passes through it, most water returns to the blood, and the rest runs on to the bladder. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
