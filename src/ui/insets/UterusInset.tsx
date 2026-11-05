import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { UTERUS_HORMONES_FULL, uterusCloseup } from "../../closeup/uterus";
import { cycleDay, cyclePhase, minutesToNextPeriod } from "../../model/cycle";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, pointAlong, tenth } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";
import { createStream, Placer } from "./stream";

type Setting = (typeof uterusCloseup.keys)[number];

const WALL = "M72 58C72 42 88 34 120 34C152 34 168 42 168 58C168 88 148 112 134 128L132 150C132 156 108 156 108 150L106 128C92 112 72 88 72 58Z";
const CAVITY = "M92 60C92 54 104 52 120 52C136 52 148 54 148 60C148 78 132 100 120 118C108 100 92 78 92 60Z";
const TUBES = "M72 54C50 44 36 48 18 38M168 54C190 44 204 48 222 38";
const CERVIX = { x: 120, top: 118, bottom: 180 };
const ARTERY_L = vessel({ id: "artery-left", radius: 3.6, points: [[-4, 112], [30, 98], [72, 76]] });
const ARTERY_R = vessel({ id: "artery-right", radius: 3.6, points: [[244, 112], [210, 98], [168, 76]] });
const LINING_WIDEST = 13; // in figure units
const LINING_NARROWEST = 2;
const SHEDDING_MOST_PER_SECOND = 1.6;

function paintUterus(art: SVGSVGElement) {
  const lining = part<SVGPathElement>(art, "lining");
  const liningWord = part<SVGGElement>(art, "lining-word");
  const drops = createStream(parts(art, "drop"), 3.2, 17);
  const hormones = createStream(parts(art, "hormone"), 3, 31);
  const shedding = part<SVGGElement>(art, "shedding");
  const arriving = part<SVGGElement>(art, "hormones");
  const paintLeft = ARTERY_L.attach(art);
  const paintRight = ARTERY_R.attach(art);
  // Hormones arrive in the blood from either side, and reach the lining.
  const fromEitherSide: Placer = (progress, seat) => {
    const left = seat < 0.5;
    const route = left ? ARTERY_L.route : ARTERY_R.route;
    if (progress < 0.7) return pointAlong(route, progress / 0.7);
    const at = pointAlong(route, 1);
    const k = (progress - 0.7) / 0.3;
    return { x: lerp(at.x, left ? 96 : 144, k), y: lerp(at.y, 72, k) };
  };
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    lining.style.strokeWidth = `${tenth(lerp(LINING_NARROWEST, LINING_WIDEST, levels.lining))}`;
    drops(frame, levels.shedding * SHEDDING_MOST_PER_SECOND, (k, seat) => ({ x: CERVIX.x + (seat - 0.5) * 6, y: lerp(CERVIX.top - 22, CERVIX.bottom, k) }));
    hormones(frame, levels.hormones * UTERUS_HORMONES_FULL, fromEitherSide);
    setLit(lining, lit.lining);
    setLit(liningWord, lit.lining);
    setLit(shedding, lit.shedding);
    setLit(arriving, lit.hormones);
    const bloodLit = levels.hormones * 3 * lit.hormones;
    paintLeft(frame, { lit: bloodLit });
    paintRight(frame, { lit: bloodLit });
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={TUBES} />
      <ARTERY_L.Art />
      <ARTERY_R.Art />
      <path className="line-ink" d={WALL} />
      <path data-part="lining" className="uterus-lining" d={CAVITY} />
      <path className="line-soft" d={CAVITY} />
      <g data-part="shedding">{Array.from({ length: 8 }, (_, k) => <circle key={k} data-part="drop" className="flow-dot" r="1.7" />)}</g>
      <g data-part="lining-word">
        <text x="176" y="130">The lining</text>
        <path className="leader" d="M180 123L140 88" />
      </g>
      <g data-part="hormones">
        {Array.from({ length: 10 }, (_, k) => <circle key={k} data-part="hormone" className="flow-dot-quiet" r="1.3" />)}
        <text x="232" y="70" textAnchor="end">Hormones arrive</text>
      </g>
    </>
  );
});

function useUterusPlate({ trajectory: { cycle }, t }: InsetProps, _levels: Levels<Setting>): PlateWords {
  const phase = cycle ? cyclePhase(cycle, t) : null;
  const doing = phase === "period" ? "lining shedding" : phase === "luteal" ? "lining ready" : "lining rebuilding";
  const caption = cycle ? `Day ${cycleDay(cycle, t)}: ${doing}` : "No cycle logged";
  const days = cycle ? Math.round(minutesToNextPeriod(cycle, t) / 1440) : null;
  return { caption, note: days !== null ? { text: `Next period in about ${days} ${days === 1 ? "day" : "days"}` } : undefined, describe: `The uterus and its lining, which thickens through a cycle and sheds in a period. ${caption}.` };
}

export const UterusInset = closeupInset(uterusCloseup, { Drawing, paint: paintUterus, usePlate: useUterusPlate });
