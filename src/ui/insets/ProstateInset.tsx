import { memo } from "react";
import { eventLevelAt } from "../../model/events";
import { value } from "../../model/simulate";
import { lerp, parts } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";
import { createStream, Placer } from "./stream";

const GLANDS = [
  { x: 76, y: 92 }, { x: 72, y: 118 }, { x: 88, y: 140 }, { x: 96, y: 74 },
  { x: 164, y: 92 }, { x: 168, y: 118 }, { x: 152, y: 140 }, { x: 144, y: 74 },
];
const URETHRA = { x: 120, top: 44, bottom: 184, half: 6 };
const ACTIVE_ABOVE = 0.05;

const fromGlands: Placer = (progress, seat) => {
  const gland = GLANDS[Math.floor(seat * GLANDS.length) % GLANDS.length];
  if (progress < 0.5) return { x: lerp(gland.x, URETHRA.x, progress / 0.5), y: gland.y };
  return { x: URETHRA.x, y: lerp(gland.y, URETHRA.bottom, (progress - 0.5) / 0.5) };
};

const sexLevel = ({ trajectory, t }: InsetProps) => Math.max(0, ...trajectory.events.filter((event) => event.preset === "sex" && event.from <= t).map((event) => eventLevelAt(event, t)));

function createPainter(art: SVGSVGElement): Painter {
  const fluid = createStream(parts(art, "fluid"), 5, 23);
  const urine = createStream(parts(art, "urine"), 2.8, 29);
  return (frame, props) => {
    fluid(frame, 0.45 + sexLevel(props) * 2.4, fromGlands);
    // Urine only passes when the bladder empties, which shows as its level dropping.
    const emptying = value(props.trajectory, "bladderMl", props.t + 1) < value(props.trajectory, "bladderMl", props.t) - 1;
    urine(frame, emptying ? 3 : 0, (k) => ({ x: URETHRA.x, y: lerp(URETHRA.top, URETHRA.bottom, k) }));
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="line-soft" d={`M58 46C66 22 174 22 182 46C178 54 ${URETHRA.x + 18} 54 ${URETHRA.x + URETHRA.half} 54H${URETHRA.x - URETHRA.half}C${URETHRA.x - 18} 54 62 54 58 46Z`} />
      <ellipse className="line-ink" cx={URETHRA.x} cy="108" rx="70" ry="54" />
      <path className="line-soft" d={`M${URETHRA.x - URETHRA.half} 54V${URETHRA.bottom}M${URETHRA.x + URETHRA.half} 54V${URETHRA.bottom}`} />
      {GLANDS.map((g) => <circle key={`${g.x}${g.y}`} className="prostate-gland" cx={g.x} cy={g.y} r="8.5" />)}
      {Array.from({ length: 14 }, (_, k) => <circle key={k} data-part="fluid" className="flow-dot" r="1.5" />)}
      {Array.from({ length: 8 }, (_, k) => <circle key={k} data-part="urine" className="flow-dot-quiet" r="1.5" />)}
      <text x="188" y="40">The bladder</text>
      <text x={URETHRA.x + 12} y="176">The urethra</text>
    </>
  );
});

export function ProstateInset(props: InsetProps) {
  const art = useInsetPainter(createPainter, props);
  const active = sexLevel(props) >= ACTIVE_ABOVE;
  const label = active ? "Refilling after sexual activity" : "Making its share of seminal fluid";
  return (
    <Plate caption={label} describe={`The prostate wrapped around the urethra below the bladder, its glands adding fluid. ${label}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
