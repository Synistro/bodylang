import { memo } from "react";
import { ledgerAt } from "../../model/simulate";
import { parts } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { along, createStream, curve, Placer } from "./stream";

const POUCHES = [20, 68, 116, 164, 212];
const TUBE = { y: 104, halfHeight: 26, bulge: 12 };
const MIDDLE = curve([[-4, TUBE.y], [120, TUBE.y], [244, TUBE.y]]);

const wall = (side: 1 | -1) => {
  const y = TUBE.y + side * TUBE.halfHeight;
  const out = y + side * TUBE.bulge;
  let d = `M-4 ${y}`;
  for (const x of POUCHES) d += `C${x - 20} ${y} ${x - 14} ${out} ${x} ${out}C${x + 14} ${out} ${x + 20} ${y} ${x + 24} ${y}`;
  return `${d}L244 ${y}`;
};

// Water leaves through the wall, up toward the blood.
const backOut: Placer = (progress, seat) => {
  const x = POUCHES[Math.floor(seat * POUCHES.length) % POUCHES.length] + (seat * 12 - 6);
  return { x, y: TUBE.y - progress * 76 };
};

function createPainter(art: SVGSVGElement): Painter {
  const contents = createStream(parts(art, "content"), 22, 6);
  const water = createStream(parts(art, "water"), 3.2, 11);
  return (frame, { trajectory, t }) => {
    const held = heldKcal({ trajectory, t });
    contents(frame, Math.min(1.1, 0.06 + held / 80), (progress, seat) => {
      const at = along(MIDDLE.route)(progress, seat);
      return { x: at.x, y: at.y + (seat - 0.5) * TUBE.halfHeight * 1.3 };
    });
    water(frame, Math.min(1.8, 0.12 + held / 60), backOut);
  };
}

const heldKcal = ({ trajectory, t }: { trajectory: InsetProps["trajectory"]; t: number }) => trajectory.scenario.intakes.reduce((sum, intake) => sum + (ledgerAt(trajectory, intake.id, t)?.colon ?? 0), 0);

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-hair" d="M-4 26H244" />
      <path className="line-soft" d={wall(-1)} />
      <path className="line-soft" d={wall(1)} />
      {Array.from({ length: 24 }, (_, k) => <circle key={k} data-part="content" className="flow-dot-food" r="2.4" />)}
      {Array.from({ length: 8 }, (_, k) => <circle key={k} data-part="water" className="flow-dot" r="1.3" />)}
      <text x="232" y="36" textAnchor="end">Water goes back to your blood</text>
      <text x="232" y="164" textAnchor="end">Fibre feeds the bacteria here</text>
    </>
  );
});

export function LargeIntestineInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const kcal = heldKcal(props);
  const label = kcal >= 5 ? `Holding ${Math.round(kcal)} kcal you didn't absorb` : "Nothing from today yet";
  return (
    <Plate caption={label} describe={`The large intestine, drawing water back through its wall as what is left moves slowly along. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
