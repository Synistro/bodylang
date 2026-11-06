import { memo } from "react";
import type { Levels } from "../../closeup/define";
import { degreesC, spleenCloseup } from "../../closeup/spleen";
import { REFERENCE } from "../../model/params";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, pointAlong, tenth, seededRandom, smoothstep } from "./draw";
import { clamp01 } from "../../model/curve";
import type { Frame, InsetProps } from "./loop";
import { setLit, setShown } from "./parts/part";
import { vessel } from "./parts/vessel";
import type { PlateWords } from "./Plate";

type Setting = (typeof spleenCloseup.keys)[number];

const SCALE = REFERENCE.temperature.scale;
const TUBE = { x: 22, top: 22, bottom: 152, halfWidth: 3.6, bulbRadius: 8.5 };
const TICK = { minor: 3.5, major: 6.5, labelGap: 3 };
const yOfTemperature = (c: number) => lerp(TUBE.bottom, TUBE.top, clamp01((c - SCALE.min) / (SCALE.max - SCALE.min)));

const SITE = { x: 130, y: 88 }; // where the trouble is
const MAX_CELLS = 40;
const IDLE_CELLS = 5; // the few that are always on patrol in the blood
const CELL_RADIUS = 4.5;
const FIRST_RING = 18.5;
const RING_STEP = 8.5;
const GOLDEN_ANGLE = 2.39996;
const WANDER = { idle: 0.9, gathered: 1.1 };
const STILL_CLOCK = 13;

const BLOOD = vessel({
  id: "blood",
  radius: 7.5,
  points: [
    [226, -8],
    [220, 40],
    [226, 92],
    [218, 140],
    [224, 188],
  ],
});
const DRIFT_SECONDS = 46; // how long a resting cell takes to float the length of the plate

// A round body with a soft outline and a lobed nucleus, the look of the cells that answer first.
function cellOutline(seed: number) {
  const random = seededRandom(seed);
  const points = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const r = CELL_RADIUS * lerp(0.9, 1.08, random());
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  let d = "";
  points.forEach((p, i) => {
    const next = points[(i + 1) % points.length];
    const middle = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
    d += i === 0 ? `M${tenth((points[8].x + p.x) / 2)} ${tenth((points[8].y + p.y) / 2)}` : "";
    d += `Q${tenth(p.x)} ${tenth(p.y)} ${tenth(middle.x)} ${tenth(middle.y)}`;
  });
  return `${d}Z`;
}
const CELL_OUTLINES = [3, 8, 14].map(cellOutline);
const NUCLEUS_LOBES = [
  { x: -1.15, y: 0.5 },
  { x: 0.2, y: -0.95 },
  { x: 1.2, y: 0.55 },
];

const KEY = { y: 174, cellX: 94, cellWordX: 101, germX: 150, germWordX: 156 };
const MAX_INVADERS = 12;
const INVADER_REACH = 8.5;
const INVADER = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2;
  return `M${tenth(Math.cos(a) * 1.7)} ${tenth(Math.sin(a) * 1.7)}L${tenth(Math.cos(a) * 3)} ${tenth(Math.sin(a) * 3)}`;
}).join("");

const CELLS = (() => {
  const random = seededRandom(29);
  return Array.from({ length: MAX_CELLS }, (_, k) => {
    const reach = FIRST_RING + RING_STEP * Math.sqrt(k);
    const angle = k * GOLDEN_ANGLE;
    return {
      gatheredX: SITE.x + Math.cos(angle) * reach,
      gatheredY: SITE.y + Math.sin(angle) * reach,
      // Cells wait in the blood, spread along the vessel, until they are called.
      inVessel: k < IDLE_CELLS ? k / IDLE_CELLS + 0.07 : random(),
      phase: random() * 6.28,
      period: lerp(6, 11, random()),
      outline: k % CELL_OUTLINES.length,
    };
  });
})();

const INVADERS = (() => {
  const random = seededRandom(37);
  return Array.from({ length: MAX_INVADERS }, () => {
    const a = random() * 6.28;
    const r = Math.sqrt(random()) * INVADER_REACH;
    return { x: SITE.x + Math.cos(a) * r, y: SITE.y + Math.sin(a) * r };
  });
})();

function paintImmune(art: SVGSVGElement) {
  const column = part<SVGPathElement>(art, "column");
  const bulb = part<SVGCircleElement>(art, "bulb");
  const pointer = part<SVGPathElement>(art, "pointer");
  const cells = parts<SVGGElement>(art, "cell");
  const invaders = parts<SVGGElement>(art, "invader");
  const germKey = part<SVGGElement>(art, "germ-key");
  const thermometer = part<SVGGElement>(art, "thermometer");
  const immune = parts<SVGGElement>(art, "immune");
  const germs = part<SVGGElement>(art, "germs");
  const paintBlood = BLOOD.attach(art);
  let wasTone = "";

  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    const { clock, still } = frame;
    const temperature = degreesC(levels.temperature);
    const y = yOfTemperature(temperature);
    column.setAttribute("d", `M${TUBE.x} ${TUBE.bottom + 4}V${tenth(y)}`);
    pointer.setAttribute("transform", `translate(${TUBE.x - TUBE.halfWidth - 1.5} ${tenth(y)})`);
    const r = REFERENCE.temperature;
    const tone = temperature >= r.dangerC ? "concern" : temperature > r.high ? "note" : "calm";
    if (tone !== wasTone) {
      wasTone = tone;
      column.dataset.tone = tone;
      bulb.dataset.tone = tone;
      pointer.dataset.tone = tone;
    }

    const wantedCells = levels.immune * MAX_CELLS;
    const now = still ? STILL_CLOCK : clock;
    cells.forEach((cell, k) => {
      const gathered = clamp01(wantedCells - k);
      const c = CELLS[k];
      const called = smoothstep(0, 1, gathered);
      const wander = lerp(WANDER.idle, WANDER.gathered, called);
      const home = pointAlong(BLOOD.route, (c.inVessel + now / DRIFT_SECONDS) % 1);
      const x = lerp(home.x, c.gatheredX, called) + Math.sin(now / c.period + c.phase) * wander;
      const y = lerp(home.y, c.gatheredY, called) + Math.cos((now / c.period) * 1.3 + c.phase) * wander;
      const shown = k < IDLE_CELLS ? 1 : gathered;
      cell.setAttribute("transform", `translate(${tenth(x)} ${tenth(y)})`);
      cell.style.opacity = String(Math.round(shown * 100) / 100);
      cell.style.visibility = shown < 0.01 ? "hidden" : "visible";
    });

    const wantedInvaders = levels.germs * MAX_INVADERS;
    invaders.forEach((invader, k) => {
      invader.style.opacity = String(Math.round(clamp01(wantedInvaders - k) * 100) / 100);
    });
    setShown(germKey, wantedInvaders >= 1 ? 1 : 0);

    setLit(thermometer, lit.temperature);
    for (const group of immune) setLit(group, lit.immune);
    setLit(germs, lit.germs);
    paintBlood(frame, { lit: levels.immune * 3 * lit.immune });
  };
}

const Drawing = memo(function Drawing() {
  const r = REFERENCE.temperature;
  const ticks: { y: number; major: boolean; label: number | null }[] = [];
  for (let c = Math.ceil(SCALE.min * 2) / 2; c <= SCALE.max - 0.25; c += 0.5) {
    const major = Number.isInteger(c);
    ticks.push({ y: yOfTemperature(c), major, label: major ? c : null });
  }
  const tubeLeft = TUBE.x - TUBE.halfWidth;
  const tubeRight = TUBE.x + TUBE.halfWidth;
  return (
    <>
      <g data-part="thermometer">
        <rect
          className="thermo-band"
          x={tubeRight}
          y={yOfTemperature(r.high)}
          width={TICK.major + 13}
          height={yOfTemperature(r.low) - yOfTemperature(r.high)}
        />
        {ticks.map((tick) => (
          <path
            key={tick.y}
            className={tick.major ? "line-soft" : "line-hair"}
            d={`M${tubeRight} ${tenth(tick.y)}h${tick.major ? TICK.major : TICK.minor}`}
          />
        ))}
        {ticks.flatMap((tick) =>
          tick.label === null
            ? []
            : [
                <text
                  key={tick.label}
                  className="inset-number"
                  x={tubeRight + TICK.major + TICK.labelGap}
                  y={tenth(tick.y + 2.2)}
                >
                  {tick.label}
                </text>,
              ],
        )}
        <path
          className="line-ink"
          d={`M${tubeLeft} ${TUBE.bottom + 1}V${TUBE.top + TUBE.halfWidth}A${TUBE.halfWidth} ${TUBE.halfWidth} 0 0 1 ${tubeRight} ${TUBE.top + TUBE.halfWidth}V${TUBE.bottom + 1}`}
        />
        <circle className="line-ink" cx={TUBE.x} cy={TUBE.bottom + TUBE.bulbRadius} r={TUBE.bulbRadius} />
        <circle
          data-part="bulb"
          className="thermo-bulb"
          cx={TUBE.x}
          cy={TUBE.bottom + TUBE.bulbRadius}
          r={TUBE.bulbRadius - 2.2}
        />
        <path data-part="column" className="thermo-column" />
        <path data-part="pointer" className="thermo-pointer" d="M-4.5 -2.6L0 0L-4.5 2.6Z" />
        <text
          x={tubeRight + TICK.major + 13 + 2}
          y={yOfTemperature((r.low + r.high) / 2) + 2.2}
          className="inset-quiet"
        >
          Typical
        </text>
      </g>
      <BLOOD.Art />
      <g data-part="immune">
        <text x="208" y="10" textAnchor="end">
          Blood
        </text>
        <g className="immune-cell" transform={`translate(${KEY.cellX} ${KEY.y - 2.2}) scale(0.72)`}>
          <path d={CELL_OUTLINES[0]} />
          {NUCLEUS_LOBES.map((lobe, i) => (
            <circle key={i} className="immune-nucleus" cx={lobe.x} cy={lobe.y} r="1.15" />
          ))}
        </g>
        <text x={KEY.cellWordX} y={KEY.y}>
          Immune cells
        </text>
      </g>
      <g data-part="germs">
        <g data-part="germ-key" style={{ opacity: 0 }}>
          <g className="immune-invader" transform={`translate(${KEY.germX} ${KEY.y - 2.2})`}>
            <circle r="1.7" />
            <path d={INVADER} />
          </g>
          <text x={KEY.germWordX} y={KEY.y}>
            Germs
          </text>
        </g>
        {INVADERS.map((invader, k) => (
          <g
            key={k}
            data-part="invader"
            className="immune-invader"
            transform={`translate(${tenth(invader.x)} ${tenth(invader.y)})`}
            style={{ opacity: 0 }}
          >
            <circle r="1.7" />
            <path d={INVADER} />
          </g>
        ))}
      </g>
      <g data-part="immune">
        {CELLS.map((cell, k) => (
          <g key={k} data-part="cell" className="immune-cell">
            <path d={CELL_OUTLINES[cell.outline]} />
            {NUCLEUS_LOBES.map((lobe, i) => (
              <circle key={i} className="immune-nucleus" cx={lobe.x} cy={lobe.y} r="1.15" />
            ))}
          </g>
        ))}
      </g>
    </>
  );
});

function temperatureLabel(c: number) {
  const r = REFERENCE.temperature;
  const shown = `${c.toFixed(1)} °C`;
  if (c >= r.feverC) return `Fever: ${shown}`;
  if (c > r.high) return `Raised: ${shown}`;
  return `Temperature: ${shown}`;
}

function useImmunePlate(_props: InsetProps, levels: Levels<Setting>): PlateWords {
  const caption = temperatureLabel(degreesC(levels.temperature));
  return {
    caption,
    describe: `A thermometer with the typical band from ${REFERENCE.temperature.low} to ${REFERENCE.temperature.high} °C, beside immune cells that gather as the immune system works harder. ${caption}.`,
  };
}

export const SpleenInset = closeupInset(spleenCloseup, { Drawing, paint: paintImmune, usePlate: useImmunePlate });
