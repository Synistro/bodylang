import { memo, useId } from "react";
import type { Levels } from "../../closeup/define";
import { beatsPerMinute, heartCloseup } from "../../closeup/heart";
import { closeupInset, Look } from "./closeupInset";
import { bump, part, parts, tenth } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import type { PlateWords } from "./Plate";

type Setting = (typeof heartCloseup.keys)[number];

type CavityPart = "atrium" | "ventricle" | "valve";

interface Cavity {
  points: { x: number; y: number; part: CavityPart }[]; // a start, then three points per curve
  atrium: { x: number; y: number; squeeze: number }; // where it shrinks toward, and how far at full contraction
  ventricle: { x: number; y: number; squeeze: number };
}

const atrium = (x: number, y: number) => ({ x, y, part: "atrium" as const });
const ventricle = (x: number, y: number) => ({ x, y, part: "ventricle" as const });
const valve = (x: number, y: number) => ({ x, y, part: "valve" as const });

// Each side of a heart is one cavity, pinched at its valve, and the two sides are nothing alike. The
// heart leans in the chest, so the valves sit at different heights. The right side (left on the plate)
// is a thin-walled crescent that stops short of the tip. The left ventricle is a thick-walled bullet.
const CAVITIES: Cavity[] = [
  {
    points: [
      atrium(46, 44),
      atrium(56, 38),
      atrium(66, 44),
      atrium(68, 56),
      atrium(69, 66),
      atrium(65, 76),
      valve(59, 85),
      ventricle(64, 94),
      ventricle(70, 112),
      ventricle(75, 128),
      ventricle(78, 136),
      ventricle(71, 138),
      ventricle(66, 134),
      ventricle(54, 126),
      ventricle(42, 112),
      ventricle(39, 102),
      ventricle(37, 96),
      ventricle(42, 90),
      valve(49, 87),
      atrium(41, 84),
      atrium(35, 76),
      atrium(35, 66),
      atrium(35, 56),
      atrium(39, 48),
      atrium(46, 44),
    ],
    atrium: { x: 52, y: 62, squeeze: 0.12 },
    ventricle: { x: 58, y: 110, squeeze: 0.14 },
  },
  {
    points: [
      atrium(84, 47),
      atrium(92, 42),
      atrium(105, 44),
      atrium(110, 53),
      atrium(113, 60),
      atrium(108, 66),
      valve(99, 70),
      ventricle(108, 82),
      ventricle(112, 108),
      ventricle(106, 134),
      ventricle(104, 144),
      ventricle(100, 152),
      ventricle(96, 151),
      ventricle(91, 150),
      ventricle(88, 138),
      ventricle(85, 126),
      ventricle(82, 112),
      ventricle(81, 90),
      valve(87, 73),
      atrium(81, 71),
      atrium(78, 64),
      atrium(78, 57),
      atrium(78, 52),
      atrium(80, 49),
      atrium(84, 47),
    ],
    atrium: { x: 94, y: 56, squeeze: 0.12 },
    ventricle: { x: 96, y: 108, squeeze: 0.26 },
  },
];

function cavityPath(cavity: Cavity, atriumContraction: number, ventricleContraction: number) {
  const moved = cavity.points.map((p) => {
    if (p.part === "valve") return `${p.x} ${p.y}`;
    const toward = p.part === "atrium" ? cavity.atrium : cavity.ventricle;
    const amount = toward.squeeze * (p.part === "atrium" ? atriumContraction : ventricleContraction);
    return `${tenth(p.x + (toward.x - p.x) * amount)} ${tenth(p.y + (toward.y - p.y) * amount)}`;
  });
  let d = `M${moved[0]}`;
  for (let i = 1; i < moved.length; i += 3) d += `C${moved[i]} ${moved[i + 1]} ${moved[i + 2]}`;
  return `${d}Z`;
}

const HEART_OUTLINE =
  "M31 62C32 50 44 33 62 32C76 31 96 33 110 44C124 55 128 96 122 124C118 144 111 158 105 166C103 169 100 169.5 97 168C78 157 46 130 33 102C28 90 30 74 31 62Z";
const HEART_CENTER = { x: 76, y: 100 };
const WHOLE_HEART_SQUEEZE = 0.035;
const AORTA = "M84 40C82 24 90 14 106 13C114 12 121 14 126 19";
const MUSCLE_HATCH = Array.from({ length: 36 }, (_, i) => `M${10 + i * 5} 20L${-30 + i * 5} 176`).join("");

const ROUTES = [
  { key: "brain", label: "Brain", y: 26 },
  { key: "gut", label: "Gut", y: 68 },
  { key: "kidneys", label: "Kidneys", y: 110 },
  { key: "muscle", label: "Muscle", y: 152 },
] as const;
const AORTA_END = { x: 126, y: 19 };
const ROUTE_END_X = 182;
const WEIGHT_PER_SHARE = 17; // figure units of line width for all of the blood
const BEAD_SHARE_OF_WEIGHT = 0.55;
const BEAD_TRAVEL_PER_BEAT = 12;
const BEAD_PERIOD = 9.1;

function paintHeart(art: SVGSVGElement) {
  const cavities = parts<SVGPathElement>(art, "cavity");
  const routes = parts<SVGGElement>(art, "route");
  const streams = parts<SVGPathElement>(art, "stream");
  const beads = parts<SVGPathElement>(art, "beads");
  const shares = parts<SVGTextElement>(art, "share");
  const whole = part<SVGGElement>(art, "whole-heart");
  let beatPhase = 0;
  let offset = 0;
  return ({ dt, still }: Frame, { levels, lit }: Look<Setting>) => {
    const hr = beatsPerMinute(levels.rate);
    if (!still) beatPhase += dt * (hr / 60);
    const phase = still ? 0.28 : beatPhase % 1;
    // The upper part of each cavity squeezes first, the lower part just after.
    const top = bump(phase, 0.08, 0.07);
    const bottom = bump(phase, 0.28, 0.12);
    const wholeScale = Math.round((1 - WHOLE_HEART_SQUEEZE * bottom) * 1000) / 1000;
    whole.setAttribute(
      "transform",
      `translate(${HEART_CENTER.x} ${HEART_CENTER.y}) scale(${wholeScale}) translate(${-HEART_CENTER.x} ${-HEART_CENTER.y})`,
    );
    setLit(whole, lit.rate);
    CAVITIES.forEach((cavity, i) => cavities[i].setAttribute("d", cavityPath(cavity, top, bottom)));
    // The streams leave the aorta side by side, so the split reads by weight like a river dividing.
    const weights = ROUTES.map((route) => levels[route.key] * WEIGHT_PER_SHARE);
    let stacked = AORTA_END.y - weights.reduce((a, b) => a + b, 0) / 2;
    ROUTES.forEach((route, i) => {
      const startY = stacked + weights[i] / 2;
      stacked += weights[i];
      const d = `M${AORTA_END.x} ${tenth(startY)}C150 ${tenth(startY)} 144 ${route.y} ${ROUTE_END_X} ${route.y}`;
      streams[i].setAttribute("d", d);
      beads[i].setAttribute("d", d);
      streams[i].style.strokeWidth = tenth(weights[i]);
      beads[i].style.strokeWidth = tenth(weights[i] * BEAD_SHARE_OF_WEIGHT);
      beads[i].setAttribute("stroke-dashoffset", tenth(((offset % BEAD_PERIOD) + BEAD_PERIOD) % BEAD_PERIOD));
      setLit(routes[i], lit[route.key]);
      const share = `${route.label} ${Math.round(levels[route.key] * 100)}%`;
      if (shares[i].textContent !== share) shares[i].textContent = share;
    });
    // Blood moves on each squeeze of the ventricles.
    if (!still) offset -= dt * (hr / 60) * BEAD_TRAVEL_PER_BEAT * (0.25 + 2.6 * bottom);
  };
}

const Drawing = memo(function Drawing() {
  const clip = useId();
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <path d={HEART_OUTLINE} />
        </clipPath>
      </defs>
      {ROUTES.map((route) => (
        <g key={route.key} data-part="route">
          <path data-part="stream" className="heart-stream" />
          <path data-part="beads" className="heart-beads" strokeDasharray={`0.1 ${BEAD_PERIOD - 0.1}`} />
          <text data-part="share" x="186" y={route.y + 2.5} />
        </g>
      ))}
      <path className="heart-vessel-wall heart-aorta" d={AORTA} />
      <path className="heart-vessel-bore heart-aorta" d={AORTA} />
      <g data-part="whole-heart">
        <path className="fill-paper" d={HEART_OUTLINE} />
        <g clipPath={`url(#${clip})`}>
          <path className="heart-muscle" d={MUSCLE_HATCH} />
        </g>
        <path className="line-ink" d={HEART_OUTLINE} />
        {CAVITIES.map((_, i) => (
          <path key={i} data-part="cavity" className="heart-cavity" />
        ))}
      </g>
    </>
  );
});

function useHeartPlate(_props: InsetProps, levels: Levels<Setting>): PlateWords {
  const caption = `${Math.round(beatsPerMinute(levels.rate))} beats a minute`;
  return {
    caption,
    describe: `A section through a beating heart. ${caption}. Line weight shows the share of blood going to the brain, gut, kidneys and muscle.`,
  };
}

export const HeartInset = closeupInset(heartCloseup, { Drawing, paint: paintHeart, usePlate: useHeartPlate });
