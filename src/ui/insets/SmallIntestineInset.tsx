import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { smallIntestineCloseup } from "../../closeup/smallIntestine";
import { value } from "../../model/engine/trajectory";
import { closeupInset, Look } from "./closeupInset";
import { part, parts, pointAlong, Polyline, tenth } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit, setWord } from "./parts/part";
import { Tag } from "./parts/Tag";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";
import { along, createStream, curve, Placer } from "./stream";

type Setting = (typeof smallIntestineCloseup.keys)[number];

const VILLI = [34, 62, 90, 118, 146, 174, 202];
const VILLUS = { base: 124, tip: 60, halfWidth: 9 };
const VESSEL_FROM_X = -10;
const VESSEL_LENGTH = 260;
const BLOOD = vessel({
  id: "blood",
  radius: 5,
  points: [
    [VESSEL_FROM_X, 138],
    [120, 136],
    [VESSEL_FROM_X + VESSEL_LENGTH, 138],
  ],
});
const LYMPH = vessel({
  id: "lymph",
  tone: "lymph",
  radius: 3.6,
  points: [
    [VESSEL_FROM_X, 156],
    [120, 154],
    [VESSEL_FROM_X + VESSEL_LENGTH, 156],
  ],
});
const FOOD = curve([
  [-4, 44],
  [120, 42],
  [244, 44],
]);
const MOST_PER_SECOND = { food: 3.4, sugar: 5.5, fat: 3.4 };

const villusPath = (x: number) =>
  `M${x - VILLUS.halfWidth} ${VILLUS.base}C${x - VILLUS.halfWidth} ${VILLUS.tip + 18} ${x - VILLUS.halfWidth + 1} ${VILLUS.tip} ${x} ${VILLUS.tip}C${x + VILLUS.halfWidth - 1} ${VILLUS.tip} ${x + VILLUS.halfWidth} ${VILLUS.tip + 18} ${x + VILLUS.halfWidth} ${VILLUS.base}`;
const CORE = (x: number) => `M${x} ${VILLUS.base + 12}V${VILLUS.tip + 10}`;

// In through the tip of one finger, down its core, and away along a vessel.
function crossing(route: Polyline, depth: number): Placer {
  return (progress, seat) => {
    const x = VILLI[Math.floor(seat * VILLI.length) % VILLI.length];
    if (progress < 0.2) return { x, y: 46 + (progress / 0.2) * (VILLUS.tip - 40) };
    if (progress < 0.56) return { x, y: VILLUS.tip + 6 + ((progress - 0.2) / 0.36) * (depth - VILLUS.tip - 6) };
    const start = (x - VESSEL_FROM_X) / VESSEL_LENGTH;
    return pointAlong(route, start + ((progress - 0.56) / 0.44) * (1 - start));
  };
}

function paintIntestine(art: SVGSVGElement) {
  const food = createStream(parts(art, "food"), 6, 2);
  const sugar = createStream(parts(art, "sugar"), 4.4, 7);
  const fat = createStream(parts(art, "fat"), 5, 9);
  const toBlood = crossing(BLOOD.route, 136);
  const toLymph = crossing(LYMPH.route, 154);
  const paintBlood = BLOOD.attach(art);
  const paintLymph = LYMPH.attach(art);
  const groups = {
    food: part<SVGGElement>(art, "foods"),
    sugar: part<SVGGElement>(art, "sugars"),
    fat: part<SVGGElement>(art, "fats"),
  };
  const tags = { sugar: part<SVGTextElement>(art, "sugar-tag"), fat: part<SVGTextElement>(art, "fat-tag") };
  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    food(frame, levels.food * MOST_PER_SECOND.food, along(FOOD.route));
    sugar(frame, levels.sugar * MOST_PER_SECOND.sugar, toBlood);
    fat(frame, levels.fat * MOST_PER_SECOND.fat, toLymph);
    for (const key of ["food", "sugar", "fat"] as const) setLit(groups[key], lit[key]);
    paintBlood(frame, { lit: levels.sugar * 3 * lit.sugar });
    paintLymph(frame, { lit: levels.fat * 3 * lit.fat });
    setWord(tags.sugar, levels.sugar * 6, lit.sugar);
    setWord(tags.fat, levels.fat * 6, lit.fat);
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <BLOOD.Art />
      <LYMPH.Art />
      {VILLI.map((x) => (
        <g key={x}>
          <path className="line-hair" d={CORE(x)} />
          <path className="line-soft" d={villusPath(x)} />
        </g>
      ))}
      <g data-part="foods">
        {Array.from({ length: 16 }, (_, k) => (
          <circle key={k} data-part="food" className="flow-dot-food" r="2.2" />
        ))}
      </g>
      <g data-part="sugars">
        {Array.from({ length: 22 }, (_, k) => (
          <circle key={k} data-part="sugar" className="flow-dot" r="1.5" />
        ))}
      </g>
      <g data-part="fats">
        {Array.from({ length: 14 }, (_, k) => (
          <circle key={k} data-part="fat" className="flow-dot-quiet" r="1.7" />
        ))}
      </g>
      <Tag part="sugar-tag" x={232} y={148} anchor="end">
        Sugar and protein, to your liver
      </Tag>
      <Tag part="fat-tag" x={232} y={166} anchor="end">
        Fat, through the lymph
      </Tag>
    </>
  );
});

function useIntestinePlate({ trajectory: tr, t }: InsetProps, _levels: Levels<Setting>): PlateWords {
  const grams =
    value(tr, "glucoseAbsorbMgMin", t) * 0.06 +
    (value(tr, "fatAbsorbGMin", t) + value(tr, "proteinAbsorbGMin", t)) * 60;
  const caption =
    grams >= 1
      ? `Absorbing ${tenth(Math.round(grams))} g an hour`
      : value(tr, "gutKcal", t) > 5
        ? "Breaking food down"
        : "Nothing to absorb";
  return {
    caption,
    describe: `The fingers lining the small intestine, passing sugar and protein into the blood and fat into the lymph. ${caption}.`,
  };
}

export const SmallIntestineInset = closeupInset(smallIntestineCloseup, {
  Drawing,
  paint: paintIntestine,
  usePlate: useIntestinePlate,
  captionFromModel: true,
});
