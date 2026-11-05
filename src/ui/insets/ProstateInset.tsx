import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { prostateCloseup } from "../../closeup/prostate";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import type { PlateWords } from "./Plate";
import { createStream, Placer } from "./stream";

type Setting = (typeof prostateCloseup.keys)[number];

const GLANDS = [
  { x: 76, y: 92 }, { x: 72, y: 118 }, { x: 88, y: 140 }, { x: 96, y: 74 },
  { x: 164, y: 92 }, { x: 168, y: 118 }, { x: 152, y: 140 }, { x: 144, y: 74 },
];
const URETHRA = { x: 120, top: 44, bottom: 184, half: 6 };
const ACTIVE_ABOVE = 0.05;
const FLUID_PER_SECOND = { least: 0.45, most: 2.85 };
const URINE_MOST_PER_SECOND = 3;

const fromGlands: Placer = (progress, seat) => {
  const gland = GLANDS[Math.floor(seat * GLANDS.length) % GLANDS.length];
  if (progress < 0.5) return { x: lerp(gland.x, URETHRA.x, progress / 0.5), y: gland.y };
  return { x: URETHRA.x, y: lerp(gland.y, URETHRA.bottom, (progress - 0.5) / 0.5) };
};

function paintProstate(art: SVGSVGElement) {
  const fluid = createStream(parts(art, "fluid"), 5, 23);
  const urine = createStream(parts(art, "urine"), 2.8, 29);
  const glands = part<SVGGElement>(art, "glands");
  const urethra = part<SVGGElement>(art, "urethra");
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    fluid(frame, lerp(FLUID_PER_SECOND.least, FLUID_PER_SECOND.most, levels.fluid), fromGlands);
    urine(frame, levels.urine * URINE_MOST_PER_SECOND, (k) => ({ x: URETHRA.x, y: lerp(URETHRA.top, URETHRA.bottom, k) }));
    setLit(glands, lit.fluid);
    setLit(urethra, lit.urine);
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={`M58 46C66 22 174 22 182 46C178 54 ${URETHRA.x + 18} 54 ${URETHRA.x + URETHRA.half} 54H${URETHRA.x - URETHRA.half}C${URETHRA.x - 18} 54 62 54 58 46Z`} />
      <ellipse className="line-ink" cx={URETHRA.x} cy="108" rx="70" ry="54" />
      <text x="188" y="40">The bladder</text>
      <g data-part="urethra">
        <path className="line-soft" d={`M${URETHRA.x - URETHRA.half} 54V${URETHRA.bottom}M${URETHRA.x + URETHRA.half} 54V${URETHRA.bottom}`} />
        {Array.from({ length: 8 }, (_, k) => <circle key={k} data-part="urine" className="flow-dot-quiet" r="1.5" />)}
        <text x={URETHRA.x + 12} y="176">The urethra</text>
      </g>
      <g data-part="glands">
        {GLANDS.map((g) => <circle key={`${g.x}${g.y}`} className="prostate-gland" cx={g.x} cy={g.y} r="8.5" />)}
        {Array.from({ length: 14 }, (_, k) => <circle key={k} data-part="fluid" className="flow-dot" r="1.5" />)}
      </g>
    </>
  );
});

function useProstatePlate(_props: InsetProps, levels: Levels<Setting>): PlateWords {
  const caption = levels.fluid >= ACTIVE_ABOVE ? "Refilling after sexual activity" : "Making its share of seminal fluid";
  return { caption, describe: `The prostate wrapped around the urethra below the bladder, its glands adding fluid. ${caption}.` };
}

export const ProstateInset = closeupInset(prostateCloseup, { Drawing, paint: paintProstate, usePlate: useProstatePlate });
