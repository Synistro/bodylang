import { memo } from "react";
import { curveStrength } from "../../model/events";
import { Trajectory, value } from "../../model/simulate";
import { easeToward, lerp, part, parts, tenth, seededRandom, smoothstep } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";

const GENERATIONS = 5;
const BORE = [11, 8, 5.6, 3.9, 2.8]; // figure units, trachea first
const CARINA = { x: 120, y: 26 };
const MAIN_ANGLE = 50; // degrees from straight down
const MAIN_LENGTH = 34;
const SPREAD = [34, 30, 28, 26];
const SHRINK = [0.78, 0.8, 0.8, 0.8];
const LOWER_GROWS = 1.34; // the branch heading down runs longer, because a lung is deeper than it is wide
const SACS_PER_TIP = 6;
const SAC_RADIUS = 3.3;
const SAC_REACH = 4.6;
const SAC_BREATH = 0.36; // how much a sac swells on a full breath
const WALL_THICKNESS = 0.62;
const RING_STEP = 3.6; // the cartilage rings that hold the big airways open
const RING_CLEAR_OF_FORK = 9;
const INNER_LIMIT = 7; // degrees: a branch stays on its own side, so the two lungs never meet
const SWOLLEN_SHARE = 0.52; // of the bore the lining takes up when fully irritated

const INHALE_SHARE = 0.4;
const STILL_BREATH = 0.3;
const COUGH_SECONDS = 0.8;
const COUGH_DASH = 26;
const COUGH_EVERY_SECONDS = { mild: 16, strong: 6 };
const COUGH_FEELING = "coughing";
const COUGH_SQUEEZE = 0.5;

interface Point {
  x: number;
  y: number;
}

interface Branch {
  generation: number;
  d: string;
  points: Point[];
  parent: Branch | null;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function curve(from: Point, control: Point, to: Point, generation: number, parent: Branch | null): Branch {
  const points = Array.from({ length: 9 }, (_, i) => {
    const k = i / 8;
    return { x: (1 - k) ** 2 * from.x + 2 * (1 - k) * k * control.x + k * k * to.x, y: (1 - k) ** 2 * from.y + 2 * (1 - k) * k * control.y + k * k * to.y };
  });
  return { generation, d: `M${tenth(from.x)} ${tenth(from.y)}Q${tenth(control.x)} ${tenth(control.y)} ${tenth(to.x)} ${tenth(to.y)}`, points, parent };
}

interface Tree {
  branches: Branch[];
  sacs: Point[];
}

const TREE: Tree = (() => {
  const branches: Branch[] = [];
  const sacs: Point[] = [];
  const random = seededRandom(13);
  const grow = (from: Point, wanted: number, length: number, generation: number, heading: number, parent: Branch) => {
    const side = heading === 0 ? Math.sign(wanted) : Math.sign(heading);
    const angle = side > 0 ? Math.max(wanted, INNER_LIMIT) : Math.min(wanted, -INNER_LIMIT);
    const to = { x: from.x + Math.sin(rad(angle)) * length, y: from.y + Math.cos(rad(angle)) * length };
    // Leaves along the parent's direction, so a fork reads as one airway dividing.
    const control = { x: from.x + Math.sin(rad(heading)) * length * 0.4, y: from.y + Math.cos(rad(heading)) * length * 0.4 };
    const branch = curve(from, control, to, generation, parent);
    branches.push(branch);
    if (generation === GENERATIONS - 1) {
      for (let k = 0; k < SACS_PER_TIP; k++) {
        const fan = angle + (k - (SACS_PER_TIP - 1) / 2) * 40;
        const reach = SAC_REACH * (k % 2 === 0 ? 1.05 : 1.75);
        sacs.push({ x: to.x + Math.sin(rad(fan)) * reach, y: to.y + Math.cos(rad(fan)) * reach });
      }
      return;
    }
    const spread = SPREAD[generation - 1];
    const next = length * SHRINK[generation - 1];
    const towardDown = angle > 0 ? -1 : 1;
    const jitter = () => lerp(-3, 3, random());
    grow(to, angle - towardDown * spread + jitter(), next, generation + 1, angle, branch);
    grow(to, angle + towardDown * spread + jitter(), next * LOWER_GROWS, generation + 1, angle, branch);
  };
  const trachea = curve({ x: CARINA.x, y: -6 }, { x: CARINA.x, y: 12 }, CARINA, 0, null);
  branches.push(trachea);
  grow(CARINA, -MAIN_ANGLE, MAIN_LENGTH, 1, 0, trachea);
  grow(CARINA, MAIN_ANGLE, MAIN_LENGTH, 1, 0, trachea);
  return { branches, sacs };
})();

const pathOfGeneration = (generation: number) =>
  TREE.branches
    .filter((b) => b.generation === generation)
    .map((b) => b.d)
    .join("");
const AIRWAYS = Array.from({ length: GENERATIONS }, (_, generation) => pathOfGeneration(generation));

// The way a cough travels: from deep in one lung, up through the bronchi and out of the trachea.
const COUGH_ROUTE = (() => {
  const deepest = TREE.branches.filter((b) => b.generation === 3)[3];
  const points: Point[] = [];
  for (let b: Branch | null = deepest; b; b = b.parent) points.push(...[...b.points].reverse());
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return { d: points.map((p, i) => `${i ? "L" : "M"}${tenth(p.x)} ${tenth(p.y)}`).join(""), length };
})();

// Rings across the big airways, the one detail that says "windpipe" at a glance.
const RINGS = (() => {
  let d = "";
  for (const branch of TREE.branches) {
    if (branch.generation > 1) continue;
    const half = BORE[branch.generation] / 2 - 0.3;
    let travelled = 0;
    for (let i = 1; i < branch.points.length; i++) {
      const a = branch.points[i - 1];
      const b = branch.points[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (b.y - a.y) / length;
      const ny = -(b.x - a.x) / length;
      for (; travelled < length; travelled += RING_STEP) {
        const x = a.x + ((b.x - a.x) * travelled) / length;
        const y = a.y + ((b.y - a.y) * travelled) / length;
        if (Math.hypot(x - CARINA.x, y - CARINA.y) < RING_CLEAR_OF_FORK) continue;
        d += `M${tenth(x + nx * half)} ${tenth(y + ny * half)}L${tenth(x - nx * half)} ${tenth(y - ny * half)}`;
      }
      travelled -= length;
    }
  }
  return d;
})();

// Fine irritated marks along the larger airways, standing in the lining.
const IRRITATION = (() => {
  const random = seededRandom(3);
  let d = "";
  for (const branch of TREE.branches) {
    if (branch.generation > 2) continue;
    const half = BORE[branch.generation] / 2;
    for (let i = 1; i < branch.points.length - 1; i++) {
      const a = branch.points[i - 1];
      const b = branch.points[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (b.y - a.y) / length;
      const ny = -(b.x - a.x) / length;
      const p = branch.points[i];
      for (const side of [-1, 1]) {
        const reach = half * lerp(0.62, 0.92, random());
        d += `M${tenth(p.x + nx * side * half * 0.98)} ${tenth(p.y + ny * side * half * 0.98)}L${tenth(p.x + nx * side * reach * 0.62)} ${tenth(p.y + ny * side * reach * 0.62)}`;
      }
    }
  }
  return d;
})();

// How strong the cough is now, from whatever illness logged it.
function coughAt(tr: Trajectory, t: number) {
  let strongest = 0;
  for (const event of tr.events) {
    for (const feeling of event.feelings) {
      if (feeling.id === COUGH_FEELING) strongest = Math.max(strongest, feeling.amount * curveStrength(feeling, event.from, event.ends, t));
    }
  }
  return strongest;
}

function createLungsPainter(art: SVGSVGElement): Painter {
  const sacs = parts<SVGCircleElement>(art, "sac");
  const lumens = parts<SVGPathElement>(art, "lumen");
  const linings = part<SVGGElement>(art, "linings");
  const irritation = part<SVGPathElement>(art, "irritation");
  const coughPulse = part<SVGPathElement>(art, "cough");
  let breathPhase = STILL_BREATH;
  let irritated = -1;
  let nextCough = 2;
  let coughBorn = -Infinity;

  return ({ dt, clock, still }, { trajectory, t }) => {
    const breaths = value(trajectory, "breaths", t);
    if (!still) breathPhase += dt * (breaths / 60);
    const phase = breathPhase % 1;
    const inhale = phase < INHALE_SHARE ? smoothstep(0, INHALE_SHARE, phase) : 1 - smoothstep(INHALE_SHARE, 1, phase);

    const cough = coughAt(trajectory, t);
    irritated = still || irritated < 0 ? cough : easeToward(irritated, cough, dt, 5);
    if (!still && cough > 0.02 && clock >= nextCough) {
      coughBorn = clock;
      nextCough = clock + lerp(COUGH_EVERY_SECONDS.mild, COUGH_EVERY_SECONDS.strong, cough);
    }
    const coughProgress = (clock - coughBorn) / COUGH_SECONDS;
    const coughing = coughProgress >= 0 && coughProgress <= 1;
    const coughHit = coughing ? 1 - coughProgress : 0;
    const fill = inhale * (1 - COUGH_SQUEEZE * coughHit) - COUGH_SQUEEZE * coughHit * 0.4;

    const scale = 1 + SAC_BREATH * fill;
    const radius = tenth(SAC_RADIUS * scale);
    for (const sac of sacs) sac.setAttribute("r", radius);

    lumens.forEach((lumen, generation) => {
      lumen.style.strokeWidth = tenth(BORE[generation] * (1 - SWOLLEN_SHARE * irritated) * (1 + 0.06 * fill));
    });
    linings.style.opacity = irritated > 0.005 ? "1" : "0";
    irritation.style.opacity = String(Math.round(irritated * 100) / 100);

    coughPulse.style.visibility = coughing ? "visible" : "hidden";
    // A positive offset, which every engine honours: the dash starts behind the route's start and runs through it.
    if (coughing) coughPulse.setAttribute("stroke-dashoffset", tenth(COUGH_DASH + COUGH_ROUTE.length * (1 - coughProgress)));
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      {TREE.sacs.map((sac, k) => (
        <circle key={k} data-part="sac" className="lung-sac" cx={tenth(sac.x)} cy={tenth(sac.y)} r={SAC_RADIUS} />
      ))}
      {AIRWAYS.map((d, generation) => (
        <path key={generation} className="airway-wall" style={{ strokeWidth: BORE[generation] + WALL_THICKNESS * 2 }} d={d} />
      ))}
      <g data-part="linings">
        {AIRWAYS.map((d, generation) => (
          <path key={generation} className="airway-lining" style={{ strokeWidth: BORE[generation] }} d={d} />
        ))}
      </g>
      {AIRWAYS.map((d, generation) => (
        <path key={generation} data-part="lumen" className="airway-lumen" style={{ strokeWidth: BORE[generation] }} d={d} />
      ))}
      <path className="airway-ring" d={RINGS} />
      <path data-part="irritation" className="airway-irritation" d={IRRITATION} />
      <path data-part="cough" className="airway-cough" strokeDasharray={`${COUGH_DASH} ${tenth(COUGH_ROUTE.length + COUGH_DASH)}`} d={COUGH_ROUTE.d} />
      <path className="leader" d={`M${CARINA.x + BORE[0] / 2 + 1} 10h6`} />
      <text x={CARINA.x + BORE[0] / 2 + 9} y="12.3">Windpipe</text>
      <path className="leader" d="M105 160H92M135 160H148" />
      <text x="120" y="162.2" textAnchor="middle">Air sacs</text>
    </>
  );
});

export function LungsInset(props: InsetProps) {
  const art = useInsetPainter(createLungsPainter, props);
  const label = `${Math.round(value(props.trajectory, "breaths", props.t))} breaths a minute`;
  const coughing = coughAt(props.trajectory, props.t) > 0.02;
  return (
    <Plate caption={label} describe={`The airway branching down to air sacs that swell with each breath. ${label}.${coughing ? " The lining is irritated and a cough travels up." : ""}`} artRef={art}>
      <Drawing />
      {coughing ? (
        <text x={CARINA.x + BORE[0] / 2 + 9} y="21" className="inset-accent">
          A cough travels up
        </text>
      ) : null}
    </Plate>
  );
}
