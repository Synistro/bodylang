import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { KIDNEY_FULL, kidneysCloseup, urineMlPerMin } from "../../closeup/kidneys";
import { REFERENCE } from "../../model/params";
import { value } from "../../model/engine/trajectory";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, pointAlong } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";
import { along, createStream, curve } from "./stream";

type Setting = (typeof kidneysCloseup.keys)[number];

const BLOOD_IN = vessel({ id: "blood-in", radius: 3.6, points: [[-4, 48], [36, 48], [62, 58], [74, 62]] });
const BLOOD_OUT = vessel({ id: "blood-out", radius: 3.6, points: [[74, 62], [98, 40], [150, 34], [244, 34]] });
const CAPSULE = { x: 74, y: 62, r: 20 };
const TUBULE = curve([[88, 76], [108, 70], [120, 86], [138, 76], [150, 92], [150, 146], [160, 156], [172, 146], [172, 92], [186, 78], [200, 84], [206, 110], [206, 184]], 90);
const BACK_FROM_TUBULE = 0.46; // how far along the tubule the water that returns gets
const BACK_TO = { x: 150, y: 34 };

// In dots a second, at a level of 1.
const MOST_PER_SECOND = { blood: 3.2 * KIDNEY_FULL.bloodFold, returning: 1.6 * KIDNEY_FULL.bloodFold, urine: 3 };
const URINE_TRICKLE_PER_SECOND = 0.12; // a kidney never stops making urine

function paintKidneys(art: SVGSVGElement) {
  const blood = createStream(parts(art, "blood"), 2.6, 5);
  const filtered = createStream(parts(art, "filtered"), 4.2, 8);
  const urine = createStream(parts(art, "urine"), 7, 13);
  const paintIn = BLOOD_IN.attach(art);
  const paintOut = BLOOD_OUT.attach(art);
  const filtering = parts<SVGGElement>(art, "filtering");
  const groups = { returning: part<SVGGElement>(art, "returning"), urine: part<SVGGElement>(art, "making-urine"), tubule: part<SVGGElement>(art, "tubule") };
  const bloodRoute = (progress: number) => (progress < 0.34 ? pointAlong(BLOOD_IN.route, progress / 0.34) : pointAlong(BLOOD_OUT.route, (progress - 0.34) / 0.66));
  const backRoute = (progress: number) => {
    if (progress < 0.72) return pointAlong(TUBULE.route, (progress / 0.72) * BACK_FROM_TUBULE);
    const from = pointAlong(TUBULE.route, BACK_FROM_TUBULE);
    const k = (progress - 0.72) / 0.28;
    return { x: lerp(from.x, BACK_TO.x, k), y: lerp(from.y, BACK_TO.y, k) };
  };
  const downTheTubule = along(TUBULE.route);
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    blood(frame, levels.blood * MOST_PER_SECOND.blood, bloodRoute);
    filtered(frame, levels.returning * MOST_PER_SECOND.returning, backRoute);
    urine(frame, Math.max(URINE_TRICKLE_PER_SECOND, levels.urine * MOST_PER_SECOND.urine), downTheTubule);
    const bloodLit = levels.blood * 3 * lit.blood;
    paintIn(frame, { lit: bloodLit });
    paintOut(frame, { lit: bloodLit });
    for (const group of filtering) setLit(group, lit.blood);
    setLit(groups.returning, lit.returning);
    setLit(groups.urine, lit.urine);
    setLit(groups.tubule, Math.max(lit.returning, lit.urine));
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <BLOOD_IN.Art />
      <BLOOD_OUT.Art />
      <g data-part="filtering">
        <circle className="line-ink" cx={CAPSULE.x} cy={CAPSULE.y} r={CAPSULE.r} />
        {[[-4, -3], [4, -5], [6, 3], [-3, 5], [0, 0]].map(([x, y]) => (
          <circle key={`${x}${y}`} className="filter-tuft" cx={CAPSULE.x + x} cy={CAPSULE.y + y} r="4.2" />
        ))}
        <text x={CAPSULE.x} y={CAPSULE.y + 32} textAnchor="middle">The filter</text>
      </g>
      <g data-part="tubule">
        <path className="tube-wall" d={TUBULE.d} />
        <path className="tube-bore" d={TUBULE.d} />
      </g>
      <g data-part="filtering">{Array.from({ length: 11 }, (_, k) => <circle key={k} data-part="blood" className="flow-dot-quiet" r="1.5" />)}</g>
      <g data-part="returning">
        {Array.from({ length: 10 }, (_, k) => <circle key={k} data-part="filtered" className="flow-dot-quiet" r="1.3" />)}
        <text x="142" y="124" textAnchor="end">Most water</text>
        <text x="142" y="133" textAnchor="end">goes back</text>
      </g>
      <g data-part="making-urine">
        {Array.from({ length: 22 }, (_, k) => <circle key={k} data-part="urine" className="flow-dot" r="1.7" />)}
        <text x="198" y="172" textAnchor="end">To your bladder</text>
      </g>
    </>
  );
});

function useKidneysPlate({ trajectory: tr, t }: InsetProps, levels: Levels<Setting>): PlateWords {
  const dry = value(tr, "fluidBalance", t) <= -tr.scenario.body.weightKg * REFERENCE.fluid.noticeableShareOfWeight * 1000;
  // The drawing's stream stops at its fullest, and the model's urine can go past it after a big drink.
  const rate = levels.urine < 1 ? levels.urine * KIDNEY_FULL.urineMlPerMin : Math.max(KIDNEY_FULL.urineMlPerMin, urineMlPerMin(tr, t));
  const caption = `Making ${rate.toFixed(1)} ml of urine a minute`;
  return { caption, note: dry ? { text: "Holding on to water" } : undefined, describe: `One of the kidney's filters. Blood passes through it, most water returns to the blood, and the rest runs on to the bladder. ${caption}.` };
}

export const KidneysInset = closeupInset(kidneysCloseup, { Drawing, paint: paintKidneys, usePlate: useKidneysPlate });
