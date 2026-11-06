import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { OVARY_HORMONES_FULL, ovariesCloseup } from "../../closeup/ovaries";
import { cyclePhase, hormonesAt } from "../../model/cycle";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, pointAlong, tenth } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit, setShown } from "./parts/part";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";
import { createStream, curve, Placer } from "./stream";

type Setting = (typeof ovariesCloseup.keys)[number];

const OVARY = { x: 92, y: 100, rx: 66, ry: 46 };
const FOLLICLE = { x: 128, y: 92, mostR: 24, shownFrom: 0.04 };
const LUTEUM_MOST_R = 16;
const RESTING = [
  { x: 58, y: 84, r: 5 },
  { x: 72, y: 118, r: 6 },
  { x: 96, y: 72, r: 4.5 },
  { x: 100, y: 128, r: 5 },
  { x: 48, y: 108, r: 4 },
];
const TUBE = curve([
  [154, 74],
  [176, 62],
  [202, 62],
  [244, 44],
]);
const BLOOD = vessel({
  id: "blood",
  radius: 4,
  points: [
    [-4, 164],
    [120, 160],
    [244, 164],
  ],
});

function paintOvaries(art: SVGSVGElement) {
  const follicle = part<SVGCircleElement>(art, "follicle");
  const luteum = part<SVGCircleElement>(art, "luteum");
  const egg = part<SVGCircleElement>(art, "egg");
  const tube = part<SVGGElement>(art, "tube");
  const hormoneGroup = part<SVGGElement>(art, "hormones");
  const hormone = createStream(parts(art, "hormone"), 3.6, 19);
  const paintBlood = BLOOD.attach(art);
  const toBlood: Placer = (progress, seat) => {
    const entry = 0.3 + seat * 0.3;
    if (progress < 0.5) {
      const end = pointAlong(BLOOD.route, entry);
      const k = progress / 0.5;
      return { x: lerp(FOLLICLE.x, end.x, k), y: lerp(FOLLICLE.y + 8, end.y, k) };
    }
    return pointAlong(BLOOD.route, entry + ((progress - 0.5) / 0.5) * (1 - entry));
  };
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    follicle.setAttribute("r", tenth(levels.follicle * FOLLICLE.mostR));
    setShown(follicle, levels.follicle < FOLLICLE.shownFrom ? 0 : 1, lit.follicle);
    luteum.setAttribute("r", tenth(levels.empty_follicle * LUTEUM_MOST_R));
    setLit(luteum, lit.empty_follicle);
    // The egg leaves along the tube around ovulation, and is gone after.
    const out = levels.egg > 0 && levels.egg < 1;
    egg.style.visibility = out ? "visible" : "hidden";
    if (out) {
      const at = pointAlong(TUBE.route, levels.egg);
      egg.setAttribute("cx", tenth(at.x));
      egg.setAttribute("cy", tenth(at.y));
    }
    setLit(tube, lit.egg);
    hormone(frame, levels.hormones * OVARY_HORMONES_FULL, toBlood);
    setLit(hormoneGroup, lit.hormones);
    paintBlood(frame, { lit: levels.hormones * 3 * lit.hormones });
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <BLOOD.Art />
      <ellipse className="line-ink" cx={OVARY.x} cy={OVARY.y} rx={OVARY.rx} ry={OVARY.ry} />
      {RESTING.map((f) => (
        <circle key={f.x} className="line-soft" cx={f.x} cy={f.y} r={f.r} />
      ))}
      <circle data-part="follicle" className="ovary-follicle" cx={FOLLICLE.x} cy={FOLLICLE.y} r="5" />
      <circle data-part="luteum" className="ovary-luteum" cx={FOLLICLE.x} cy={FOLLICLE.y} r="0" />
      <g data-part="tube">
        <path className="line-soft" d={TUBE.d} />
        <circle data-part="egg" className="flow-dot-food" r="3.4" style={{ visibility: "hidden" }} />
        <text x="232" y="36" textAnchor="end">
          The tube, to the uterus
        </text>
      </g>
      <g data-part="hormones">
        {Array.from({ length: 16 }, (_, k) => (
          <circle key={k} data-part="hormone" className="flow-dot" r="1.4" />
        ))}
        <text x="232" y="176" textAnchor="end">
          Hormones into your blood
        </text>
      </g>
    </>
  );
});

function useOvariesPlate({ trajectory: { cycle }, t }: InsetProps, _levels: Levels<Setting>): PlateWords {
  if (!cycle) return { caption: "No cycle logged", describe: "An ovary, with follicles at rest." };
  const phase = cyclePhase(cycle, t);
  const made = hormonesAt(cycle, t);
  const caption =
    phase === "luteal"
      ? `Progesterone: ${made.progesterone.toFixed(1)} nmol/L`
      : `Estrogen: ${Math.round(made.estradiol)} pmol/L`;
  const note =
    phase === "ovulation"
      ? "An egg leaves about now"
      : phase === "luteal"
        ? "The empty follicle makes this"
        : "A follicle is growing";
  return {
    caption,
    note: { text: note },
    describe: `An ovary. A follicle grows through the first half of a cycle, releases an egg, and then makes progesterone. ${caption}.`,
  };
}

export const OvariesInset = closeupInset(ovariesCloseup, {
  Drawing,
  paint: paintOvaries,
  usePlate: useOvariesPlate,
  captionFromModel: true,
});
