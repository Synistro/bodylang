import { memo } from "react";
import { value } from "../../model/simulate";
import { parts, pointAlong, tenth } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { along, createStream, curve, Placer } from "./stream";

const VILLI = [34, 62, 90, 118, 146, 174, 202];
const VILLUS = { base: 124, tip: 60, halfWidth: 9 };
const BLOOD = curve([[-4, 138], [120, 136], [244, 138]]);
const LYMPH = curve([[-4, 156], [120, 154], [244, 156]]);
const FOOD = curve([[-4, 44], [120, 42], [244, 44]]);

const villusPath = (x: number) => `M${x - VILLUS.halfWidth} ${VILLUS.base}C${x - VILLUS.halfWidth} ${VILLUS.tip + 18} ${x - VILLUS.halfWidth + 1} ${VILLUS.tip} ${x} ${VILLUS.tip}C${x + VILLUS.halfWidth - 1} ${VILLUS.tip} ${x + VILLUS.halfWidth} ${VILLUS.tip + 18} ${x + VILLUS.halfWidth} ${VILLUS.base}`;
const CORE = (x: number) => `M${x} ${VILLUS.base + 12}V${VILLUS.tip + 10}`;

// In through the tip of one finger, down its core, and away along a vessel.
function crossing(route: typeof BLOOD.route, depth: number): Placer {
  return (progress, seat) => {
    const x = VILLI[Math.floor(seat * VILLI.length) % VILLI.length];
    if (progress < 0.2) return { x, y: 46 + (progress / 0.2) * (VILLUS.tip - 40) };
    if (progress < 0.56) return { x, y: VILLUS.tip + 6 + ((progress - 0.2) / 0.36) * (depth - VILLUS.tip - 6) };
    const start = x / 240;
    return pointAlong(route, start + ((progress - 0.56) / 0.44) * (1 - start));
  };
}

function createPainter(art: SVGSVGElement): Painter {
  const food = createStream(parts(art, "food"), 6, 2);
  const sugar = createStream(parts(art, "sugar"), 4.4, 7);
  const fat = createStream(parts(art, "fat"), 5, 9);
  const toBlood = crossing(BLOOD.route, 136);
  const toLymph = crossing(LYMPH.route, 154);
  return (frame, { trajectory, t }) => {
    const v = (name: "gutKcal" | "glucoseAbsorbMgMin" | "fatAbsorbGMin" | "proteinAbsorbGMin") => value(trajectory, name, t);
    food(frame, Math.min(3.4, v("gutKcal") / 60), along(FOOD.route));
    sugar(frame, Math.min(5.5, v("glucoseAbsorbMgMin") / 110 + v("proteinAbsorbGMin") * 2.2), toBlood);
    fat(frame, Math.min(3.4, v("fatAbsorbGMin") * 7), toLymph);
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-hair" d={BLOOD.d} />
      <path className="line-hair" d={LYMPH.d} />
      {VILLI.map((x) => (
        <g key={x}>
          <path className="line-hair" d={CORE(x)} />
          <path className="line-soft" d={villusPath(x)} />
        </g>
      ))}
      {Array.from({ length: 16 }, (_, k) => <circle key={k} data-part="food" className="flow-dot-food" r="2.2" />)}
      {Array.from({ length: 22 }, (_, k) => <circle key={k} data-part="sugar" className="flow-dot" r="1.5" />)}
      {Array.from({ length: 14 }, (_, k) => <circle key={k} data-part="fat" className="flow-dot-quiet" r="1.7" />)}
      <text x="232" y="147" textAnchor="end">Sugar and protein, to your liver</text>
      <text x="232" y="166" textAnchor="end">Fat, through the lymph</text>
    </>
  );
});

export function SmallIntestineInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const { trajectory: tr, t } = props;
  const grams = value(tr, "glucoseAbsorbMgMin", t) * 0.06 + (value(tr, "fatAbsorbGMin", t) + value(tr, "proteinAbsorbGMin", t)) * 60;
  const label = grams >= 1 ? `Absorbing ${tenth(Math.round(grams))} g an hour` : value(tr, "gutKcal", t) > 5 ? "Breaking food down" : "Nothing to absorb";
  return (
    <Plate caption={label} describe={`The fingers lining the small intestine, passing sugar and protein into the blood and fat into the lymph. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
