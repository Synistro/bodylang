import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { LIVER_FULL, liverCloseup } from "../../closeup/liver";
import { LIVER } from "../../model/params";
import { assessmentAt } from "../hooks";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, tenth } from "./draw";
import { clamp01 } from "../../model/curve";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import type { PlateWords } from "./Plate";

type Setting = (typeof liverCloseup.keys)[number];

const ROWS = [9, 10, 11, 12, 13, 13, 12, 11, 10, 9];
const GRANULE_COUNT = ROWS.reduce((a, b) => a + b, 0);
const STEP = { x: 8, y: 7.2 };
const CELL_CENTER = { x: 120, y: 72 };
const CELL = "M62 72L83 31H157L178 72L157 113H83Z";

// Bottom row first, from the middle out, so the store reads as a level rising and falling.
const GRANULES = ROWS.flatMap((count, row) => {
  const y = CELL_CENTER.y + (row - (ROWS.length - 1) / 2) * STEP.y;
  return Array.from({ length: count }, (_, i) => {
    const offset = i - (count - 1) / 2;
    return { x: CELL_CENTER.x + offset * STEP.x, y, row, offset };
  });
});
const FILL_ORDER = GRANULES.map((_, i) => i).sort(
  (a, b) => GRANULES[b].row - GRANULES[a].row || Math.abs(GRANULES[a].offset) - Math.abs(GRANULES[b].offset),
);

const INFLOW = "M-4 124C30 124 30 72 62 72";
const OUTFLOW = "M178 72C210 72 210 30 244 30";
const FLOW_FULL_G_PER_MIN = 0.4; // where a stream is at its widest and fastest
const STREAM = { min: 0.8, max: 8.5 };
const BEAD_SPEED = { min: 3, max: 16 }; // figure units a second
const ACTIVE_ABOVE_G_PER_MIN = 0.015;

const streamWeight = (gPerMin: number) =>
  lerp(STREAM.min, STREAM.max, Math.sqrt(clamp01(gPerMin / FLOW_FULL_G_PER_MIN)));

const gramsPerHour = (gPerMin: number) => `${Math.round(gPerMin * 60)} g/h`;

function paintLiver(art: SVGSVGElement) {
  const granules = parts<SVGCircleElement>(art, "granule");
  const store = part<SVGGElement>(art, "store");
  const stream = (name: string) => ({
    group: part<SVGGElement>(art, name),
    body: part<SVGPathElement>(art, `${name}-stream`),
    beads: part<SVGPathElement>(art, `${name}-beads`),
    rate: part<SVGTextElement>(art, `${name}-rate`),
    offset: 0,
  });
  const takingIn = stream("taking-in");
  const releasing = stream("releasing");
  let stored = -1;

  const paintStream = (flow: ReturnType<typeof stream>, level: number, lit: number, dt: number) => {
    const gPerMin = level * LIVER_FULL.sugarGPerMin;
    const weight = streamWeight(gPerMin);
    const active = gPerMin > ACTIVE_ABOVE_G_PER_MIN;
    flow.offset -= dt * lerp(BEAD_SPEED.min, BEAD_SPEED.max, clamp01(gPerMin / FLOW_FULL_G_PER_MIN));
    flow.body.style.strokeWidth = tenth(weight);
    flow.beads.style.strokeWidth = tenth(weight);
    const period = weight * 1.5 + 4.1;
    flow.beads.setAttribute("stroke-dasharray", `0.1 ${tenth(period - 0.1)}`);
    flow.beads.setAttribute("stroke-dashoffset", tenth(((flow.offset % period) + period) % period));
    flow.beads.style.visibility = active ? "visible" : "hidden";
    flow.body.style.visibility = active ? "visible" : "hidden";
    setLit(flow.group, lit);
    const rate = gramsPerHour(gPerMin);
    if (flow.rate.textContent !== rate) flow.rate.textContent = rate;
  };

  return ({ dt }: Frame, { levels, lit }: Look<Setting>) => {
    const wanted = Math.round(levels.store * GRANULE_COUNT);
    if (wanted !== stored) {
      stored = wanted;
      FILL_ORDER.forEach((granule, rank) => granules[granule].toggleAttribute("data-stored", rank < wanted));
    }
    setLit(store, lit.store);
    paintStream(takingIn, levels.taking_in, lit.taking_in, dt);
    paintStream(releasing, levels.releasing, lit.releasing, dt);
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <g data-part="taking-in">
        <path className="pipe-wall" d={INFLOW} />
        <path className="pipe-bore" d={INFLOW} />
        <path data-part="taking-in-stream" className="stream-body" d={INFLOW} />
        <path data-part="taking-in-beads" className="stream-beads" d={INFLOW} />
        <text x="0.4" y="74">
          From gut
        </text>
        <text data-part="taking-in-rate" x="0.4" y="82" />
      </g>
      <g data-part="releasing">
        <path className="pipe-wall" d={OUTFLOW} />
        <path className="pipe-bore" d={OUTFLOW} />
        <path data-part="releasing-stream" className="stream-body" d={OUTFLOW} />
        <path data-part="releasing-beads" className="stream-beads" d={OUTFLOW} />
        <text x="239" y="68" textAnchor="end">
          To blood
        </text>
        <text data-part="releasing-rate" x="239" y="76" textAnchor="end" />
      </g>
      <path className="fill-paper" d={CELL} />
      <path className="line-ink" d={CELL} />
      <g data-part="store">
        {GRANULES.map((g, i) => (
          <circle key={i} data-part="granule" className="liver-granule" cx={g.x} cy={g.y} r="2.9" />
        ))}
      </g>
    </>
  );
});

function useLiverPlate({ trajectory, t }: InsetProps, levels: Levels<Setting>): PlateWords {
  const caption = `Liver fuel: ${Math.round(levels.store * LIVER_FULL.glycogenG)} of ${LIVER.glycogenMaxG} g`;
  // The number is the caption, so its verdict has to live there too once the row is gone.
  const fuel = assessmentAt(trajectory, t).readings.find((r) => r.id === "glycogen");
  const note =
    fuel && fuel.tone !== "calm" ? { text: `${fuel.verdictWord}. ${fuel.why}`, tone: "attention" as const } : undefined;
  return {
    caption,
    captionHint: "Glycogen, the sugar your liver keeps in store. One dot is one gram.",
    note,
    describe: `A liver cell holding its fuel store, one dot per gram. ${caption}. Sugar comes in from the gut on the left and leaves for the blood on the right.`,
  };
}

export const LiverInset = closeupInset(liverCloseup, { Drawing, paint: paintLiver, usePlate: useLiverPlate });
