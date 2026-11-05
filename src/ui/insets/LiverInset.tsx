import { memo } from "react";
import { CAFFEINE, LIVER } from "../../model/params";
import { Trajectory, value } from "../../model/simulate";
import { clamp01, easeToward, lerp, part, parts, tenth, smoothstep } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { assessmentAt } from "../hooks";
import { Plate } from "./Plate";

const ROWS = [9, 10, 11, 12, 13, 13, 12, 11, 10, 9];
const GRANULE_COUNT = ROWS.reduce((a, b) => a + b, 0);
const GRAMS_PER_GRANULE = LIVER.glycogenMaxG / GRANULE_COUNT;
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
const FILL_ORDER = GRANULES.map((_, i) => i).sort((a, b) => GRANULES[b].row - GRANULES[a].row || Math.abs(GRANULES[a].offset) - Math.abs(GRANULES[b].offset));

const INFLOW = "M-4 124C30 124 30 72 62 72";
const OUTFLOW = "M178 72C210 72 210 30 244 30";
const FLOW_FULL_G_PER_MIN = 0.4;
const STREAM = { min: 0.8, max: 8.5 };
const BEAD_SPEED = { min: 3, max: 16 }; // figure units a second
const ACTIVE_ABOVE_G_PER_MIN = 0.015;

const LANE_Y = 146;
const CLEARING_X = 120;
const CAFFEINE_SECONDS = 4.6;
const CAFFEINE_POOL = 5;
const CAFFEINE_MARK = "M0 -3.1L2.9 0L0 3.1L-2.9 0Z";
const FRAGMENTS = [
  { dx: 22, dy: -9 },
  { dx: 30, dy: 0 },
  { dx: 22, dy: 9 },
];
const CAFFEINE_PRESENT_MG_L = 0.02;
// One mark for this many mg cleared each hour, within what the eye can follow.
const CAFFEINE_MARK_MG_PER_HOUR = 3;
const CAFFEINE_INTERVAL_SECONDS = { min: 0.9, max: 6 };

function streamWeight(gPerMin: number) {
  return lerp(STREAM.min, STREAM.max, Math.sqrt(clamp01(gPerMin / FLOW_FULL_G_PER_MIN)));
}

function caffeineClearedMgPerHour(tr: Trajectory, t: number) {
  const halfLifeH = tr.scenario.caffeineHalfLifeH ?? tr.anthro.caffeineHalfLifeH;
  const mgInBody = value(tr, "caffeine", t) * CAFFEINE.volumeLPerKg * tr.scenario.body.weightKg;
  return (mgInBody * Math.LN2) / halfLifeH;
}

function createLiverPainter(art: SVGSVGElement): Painter {
  const granules = parts<SVGCircleElement>(art, "granule");
  const streams = {
    inflow: { body: part<SVGPathElement>(art, "inflow"), beads: part<SVGPathElement>(art, "inflow-beads"), weight: -1, offset: 0 },
    outflow: { body: part<SVGPathElement>(art, "outflow"), beads: part<SVGPathElement>(art, "outflow-beads"), weight: -1, offset: 0 },
  };
  const tokens = parts<SVGGElement>(art, "caffeine-token");
  const lane = part<SVGGElement>(art, "caffeine-lane");
  const tokenBorn = new Float32Array(CAFFEINE_POOL).fill(-Infinity);
  let nextToken = 0;
  let nextEmission = 0;
  let stored = -1;

  const paintStream = (stream: typeof streams.inflow, gPerMin: number, dt: number, still: boolean) => {
    const target = streamWeight(gPerMin);
    stream.weight = still || stream.weight < 0 ? target : easeToward(stream.weight, target, dt, 6);
    const active = gPerMin > ACTIVE_ABOVE_G_PER_MIN;
    stream.offset -= dt * lerp(BEAD_SPEED.min, BEAD_SPEED.max, clamp01(gPerMin / FLOW_FULL_G_PER_MIN));
    stream.body.style.strokeWidth = tenth(stream.weight);
    stream.beads.style.strokeWidth = tenth(stream.weight);
    const period = stream.weight * 1.5 + 4.1;
    stream.beads.setAttribute("stroke-dasharray", `0.1 ${tenth(period - 0.1)}`);
    stream.beads.setAttribute("stroke-dashoffset", tenth(((stream.offset % period) + period) % period));
    stream.beads.style.visibility = active ? "visible" : "hidden";
    stream.body.style.visibility = active ? "visible" : "hidden";
  };

  return ({ dt, clock, still }, { trajectory, t }) => {
    const wanted = Math.round(value(trajectory, "liverGlycogen", t) / GRAMS_PER_GRANULE);
    if (wanted !== stored) {
      stored = wanted;
      FILL_ORDER.forEach((granule, rank) => granules[granule].toggleAttribute("data-stored", rank < wanted));
    }
    paintStream(streams.inflow, value(trajectory, "liverUptakeGMin", t), dt, still);
    paintStream(streams.outflow, value(trajectory, "hepaticOutputGMin", t), dt, still);

    const present = value(trajectory, "caffeine", t) > CAFFEINE_PRESENT_MG_L;
    lane.style.opacity = present ? "1" : "0";
    if (!present) return;
    if (!still && clock >= nextEmission) {
      tokenBorn[nextToken] = clock;
      nextToken = (nextToken + 1) % CAFFEINE_POOL;
      const interval = CAFFEINE_MARK_MG_PER_HOUR / Math.max(caffeineClearedMgPerHour(trajectory, t), 0.01);
      nextEmission = clock + Math.max(CAFFEINE_INTERVAL_SECONDS.min, Math.min(CAFFEINE_INTERVAL_SECONDS.max, interval));
    }
    tokens.forEach((token, k) => {
      const age = still ? ((k + 0.5) / CAFFEINE_POOL) * CAFFEINE_SECONDS : clock - tokenBorn[k];
      const shown = age >= 0 && age <= CAFFEINE_SECONDS;
      token.style.visibility = shown ? "visible" : "hidden";
      if (!shown) return;
      const progress = age / CAFFEINE_SECONDS;
      const [mark, ...fragments] = Array.from(token.children);
      const broken = smoothstep(0.55, 1, progress);
      mark.setAttribute("transform", `translate(${tenth(lerp(2, CLEARING_X, clamp01(progress / 0.55)))} ${LANE_Y})`);
      mark.setAttribute("opacity", progress < 0.55 ? "1" : "0");
      fragments.forEach((fragment, i) => {
        fragment.setAttribute("cx", tenth(CLEARING_X + FRAGMENTS[i].dx * broken));
        fragment.setAttribute("cy", tenth(LANE_Y + FRAGMENTS[i].dy * broken));
        fragment.setAttribute("opacity", progress < 0.55 ? "0" : tenth(1 - broken));
      });
    });
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <path className="pipe-wall" d={INFLOW} />
      <path className="pipe-bore" d={INFLOW} />
      <path className="pipe-wall" d={OUTFLOW} />
      <path className="pipe-bore" d={OUTFLOW} />
      <path data-part="inflow" className="stream-body" d={INFLOW} />
      <path data-part="inflow-beads" className="stream-beads" d={INFLOW} />
      <path data-part="outflow" className="stream-body" d={OUTFLOW} />
      <path data-part="outflow-beads" className="stream-beads" d={OUTFLOW} />
      <path className="fill-paper" d={CELL} />
      <path className="line-ink" d={CELL} />
      {GRANULES.map((g, i) => (
        <circle key={i} data-part="granule" className="liver-granule" cx={g.x} cy={g.y} r="2.9" />
      ))}
      <g data-part="caffeine-lane" className="liver-lane">
        <path className="line-hair" d={`M0 ${LANE_Y}H${CLEARING_X - 5}`} />
        <path className="line-hair" d={`M${CLEARING_X} 113V${LANE_Y - 5}`} />
        <circle className="line-soft" cx={CLEARING_X} cy={LANE_Y} r="5" />
        {Array.from({ length: CAFFEINE_POOL }, (_, k) => (
          <g key={k} data-part="caffeine-token">
            <path className="mark-caffeine" d={CAFFEINE_MARK} />
            {FRAGMENTS.map((_, i) => (
              <circle key={i} className="mark-caffeine" r="1.1" />
            ))}
          </g>
        ))}
      </g>
    </>
  );
});

const gramsPerHour = (gPerMin: number) => `${Math.round(gPerMin * 60)} g/h`;

export function LiverInset(props: InsetProps) {
  const art = useInsetPainter(createLiverPainter, props);
  const { trajectory, t } = props;
  const label = `Liver fuel: ${Math.round(value(trajectory, "liverGlycogen", t))} of ${LIVER.glycogenMaxG} g`;
  // The number is the caption, so its verdict has to live there too once the row is gone.
  const fuel = assessmentAt(trajectory, t).readings.find((r) => r.id === "glycogen");
  const note = fuel && fuel.tone !== "calm" ? { text: `${fuel.verdictWord}. ${fuel.why}`, tone: "attention" as const } : undefined;
  return (
    <Plate caption={label} captionHint="Glycogen, the sugar your liver keeps in store. One dot is one gram." note={note} describe={`A liver cell holding its fuel store, one dot per gram. ${label}. Sugar comes in from the gut on the left and leaves for the blood on the right.`} artRef={art}>
      <Drawing />
      <text x="0.4" y="74">From gut</text>
      <text x="0.4" y="82">{gramsPerHour(value(trajectory, "liverUptakeGMin", t))}</text>
      <text x="239" y="68" textAnchor="end">To blood</text>
      <text x="239" y="76" textAnchor="end">{gramsPerHour(value(trajectory, "hepaticOutputGMin", t))}</text>
      {value(trajectory, "caffeine", t) > CAFFEINE_PRESENT_MG_L ? (
        <text x={CLEARING_X} y={LANE_Y + 14} textAnchor="middle">
          Clearing caffeine
        </text>
      ) : null}
    </Plate>
  );
}
