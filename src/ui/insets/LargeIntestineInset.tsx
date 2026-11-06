import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { heldKcal, LARGE_INTESTINE_FULL, largeIntestineCloseup } from "../../closeup/largeIntestine";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";
import { along, createStream, curve, Placer } from "./stream";

type Setting = (typeof largeIntestineCloseup.keys)[number];

const POUCHES = [20, 68, 116, 164, 212];
const TUBE = { y: 104, halfHeight: 26, bulge: 12 };
const MIDDLE = curve([
  [-4, TUBE.y],
  [120, TUBE.y],
  [244, TUBE.y],
]);
const BLOOD = vessel({
  id: "blood",
  radius: 4,
  points: [
    [-10, 24],
    [120, 24],
    [250, 24],
  ],
});
const CONTENTS_PER_SECOND = { least: 0.06, most: 1.1 };
const WATER_PER_SECOND = { least: 0.12, most: 1.8 };

const wall = (side: 1 | -1) => {
  const y = TUBE.y + side * TUBE.halfHeight;
  const out = y + side * TUBE.bulge;
  let d = `M-4 ${y}`;
  for (const x of POUCHES)
    d += `C${x - 20} ${y} ${x - 14} ${out} ${x} ${out}C${x + 14} ${out} ${x + 20} ${y} ${x + 24} ${y}`;
  return `${d}L244 ${y}`;
};

// Water leaves through the wall, up toward the blood.
const backOut: Placer = (progress, seat) => {
  const x = POUCHES[Math.floor(seat * POUCHES.length) % POUCHES.length] + (seat * 12 - 6);
  return { x, y: TUBE.y - progress * 76 };
};

const inTheMiddle = along(MIDDLE.route);
const movingAlong: Placer = (progress, seat) => {
  const at = inTheMiddle(progress, seat);
  return { x: at.x, y: at.y + (seat - 0.5) * TUBE.halfHeight * 1.3 };
};

function paintLargeIntestine(art: SVGSVGElement) {
  const contents = createStream(parts(art, "content"), 22, 6);
  const water = createStream(parts(art, "water"), 3.2, 11);
  const paintBlood = BLOOD.attach(art);
  const contentGroup = part<SVGGElement>(art, "contents");
  const waterGroup = part<SVGGElement>(art, "returning");
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    contents(frame, lerp(CONTENTS_PER_SECOND.least, CONTENTS_PER_SECOND.most, levels.contents), movingAlong);
    water(frame, lerp(WATER_PER_SECOND.least, WATER_PER_SECOND.most, levels.water), backOut);
    setLit(contentGroup, lit.contents);
    setLit(waterGroup, lit.water);
    paintBlood(frame, { lit: levels.water * 3 * lit.water });
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <BLOOD.Art />
      <path className="line-soft" d={wall(-1)} />
      <path className="line-soft" d={wall(1)} />
      <g data-part="contents">
        {Array.from({ length: 24 }, (_, k) => (
          <circle key={k} data-part="content" className="flow-dot-food" r="2.4" />
        ))}
        <text x="232" y="164" textAnchor="end">
          Fibre feeds the bacteria here
        </text>
      </g>
      <g data-part="returning">
        {Array.from({ length: 8 }, (_, k) => (
          <circle key={k} data-part="water" className="flow-dot" r="1.3" />
        ))}
        <text x="232" y="36" textAnchor="end">
          Water goes back to your blood
        </text>
      </g>
    </>
  );
});

function useLargeIntestinePlate({ trajectory, t }: InsetProps, levels: Levels<Setting>): PlateWords {
  // The drawing's stream stops at its fullest, and what the model has counted here keeps growing through the day.
  const { contentsKcal } = LARGE_INTESTINE_FULL;
  const kcal = levels.contents < 1 ? levels.contents * contentsKcal : Math.max(contentsKcal, heldKcal(trajectory, t));
  const caption = kcal >= 5 ? `Holding ${Math.round(kcal)} kcal you didn't absorb` : "Nothing from today yet";
  return {
    caption,
    describe: `The large intestine, drawing water back through its wall as what is left moves slowly along. ${caption}.`,
  };
}

export const LargeIntestineInset = closeupInset(largeIntestineCloseup, {
  Drawing,
  paint: paintLargeIntestine,
  usePlate: useLargeIntestinePlate,
});
