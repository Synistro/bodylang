import { memo } from "react";
import { BodyEvent, MuscleState, muscleStateAt } from "../../model/events";
import type { MuscleGroup } from "../../model/muscleGroups";
import { MUSCLE_RECOVERY, REFERENCE } from "../../model/params";
import { bump, clamp01, easeToward, lerp, part, parts, tenth, seededRandom, smoothstep } from "./draw";
import { InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate } from "./Plate";

const FIBRES = 9;
const STRIATION_STEP = 4.2;
const SAMPLES = 24;
const LEFT = -4;
const CUT = { x: 200, y: 104, rx: 17, ry: 52 };
const LEFT_TAPER = 0.84; // the bundle runs a little narrower toward the edge of the plate
const SHORTENS = 26; // figure units the cut end travels at full contraction
const BULGES = 0.17;
const FATIGUE_HOLD = 0.2; // a worked muscle stays a little swollen for a while
const REP_SECONDS = 2.8;
const WORK_MOVES_FROM = 0.02;
const STILL_REP = 0.5;
const ROUND_BANDS = 80; // degrees: bands narrow toward the edges, because the bundle is round
const EDGE_WAVER = 0.9; // fibres are living things and never run ruler straight

const MAX_MARKS = 42; // tears and repairs at full soreness and full repair
const TEAR_MIN_SPACING = 7;
const PATCH_HALF_LENGTH = 3.6;
const STITCH_HALF_LENGTH = 2.8;

const VESSEL = "M-4 31C60 25 170 25 244 31";
const VESSEL_Y = (x: number) => {
  const k = (x + 4) / 248;
  return (1 - k) ** 3 * 31 + 3 * (1 - k) ** 2 * k * 25 + 3 * (1 - k) * k * k * 25 + k ** 3 * 31;
};
const VESSEL_BEAD_PERIOD = 13;
const SUGAR_POOL = 14;
const SUGAR_SECONDS = 1.7;
const SUGAR_PER_SECOND = 4.2;

// The first tear and the first repair sit low in the bundle, where a short leader can name them.
const KEY_SITES = { tear: { fibre: 7, s: 0.3 }, repair: { fibre: 7, s: 0.58 } };
const KEY_LEADER_END_Y = 165;
const KEY_TEXT_Y = 172;

const WAVER = (() => {
  const random = seededRandom(5);
  return Array.from({ length: FIBRES + 1 }, () => ({ phase: random() * 6.28, wave: lerp(0.018, 0.034, random()) }));
})();

const BAND_EDGES = Array.from({ length: FIBRES + 1 }, (_, i) => Math.sin((((i / FIBRES) * 2 - 1) * ROUND_BANDS * Math.PI) / 180) / Math.sin((ROUND_BANDS * Math.PI) / 180));

// The ends of the fibres on the cut face, packed the way they sit in a bundle.
const FIBRE_ENDS = (() => {
  const step = 0.235;
  const ends: { x: number; y: number }[] = [];
  for (let row = -5; row <= 5; row++) {
    for (let column = -5; column <= 5; column++) {
      const x = (column + (row % 2 === 0 ? 0 : 0.5)) * step;
      const y = row * step * 0.866;
      if (Math.hypot(x, y) < 0.9) ends.push({ x, y });
    }
  }
  return ends;
})();
const FIBRE_END_RADIUS = 0.1;

interface TearSite {
  fibre: number;
  s: number; // along the visible length, 0 to 1
  jag: number[]; // sideways offsets of the crack
}

// Fixed places, so soreness adds to what is there and repair covers the same ones in the same order.
const TEAR_SITES: TearSite[] = (() => {
  const random = seededRandom(19);
  const sites: TearSite[] = [KEY_SITES.tear, KEY_SITES.repair].map((site) => ({ ...site, jag: [0.5, -1.2, 1.2, -0.5] }));
  for (let attempt = 0; attempt < 4000 && sites.length < MAX_MARKS; attempt++) {
    const fibre = 1 + Math.floor(random() * (FIBRES - 2));
    const s = lerp(0.04, 0.86, random());
    const clash = sites.some((o) => {
      const dx = Math.abs(o.s - s) * (CUT.x - LEFT);
      const rows = Math.abs(o.fibre - fibre);
      return rows === 0 ? dx < TEAR_MIN_SPACING * 2.4 : rows === 1 && dx < TEAR_MIN_SPACING;
    });
    if (!clash) sites.push({ fibre, s, jag: [lerp(-0.8, 0.8, random()), lerp(-1.5, 1.5, random()), lerp(-1.5, 1.5, random()), lerp(-0.8, 0.8, random())] });
  }
  return sites;
})();

interface Shape {
  cutX: number;
  ry: number;
  halfHeight: (x: number) => number;
  edgeY: (edge: number, x: number) => number;
  endX: (y: number) => number; // where a line at height y meets the cut face
}

function shapeFor(contraction: number): Shape {
  const cutX = CUT.x - SHORTENS * contraction;
  const ry = CUT.ry * (1 + BULGES * contraction);
  const halfHeight = (x: number) => ry * lerp(LEFT_TAPER, 1, clamp01((x - LEFT) / (cutX - LEFT)));
  return {
    cutX,
    ry,
    halfHeight,
    edgeY: (edge, x) => {
      const inner = edge > 0 && edge < FIBRES ? EDGE_WAVER * Math.sin(x * WAVER[edge].wave + WAVER[edge].phase) : 0;
      return CUT.y + BAND_EDGES[edge] * halfHeight(x) + inner;
    },
    endX: (y) => cutX - CUT.rx * Math.sqrt(Math.max(0, 1 - ((y - CUT.y) / ry) ** 2)),
  };
}

function fibrePaths(shape: Shape) {
  let edges = "";
  let striations = "";
  for (let edge = 0; edge <= FIBRES; edge++) {
    const endX = shape.endX(CUT.y + BAND_EDGES[edge] * shape.ry);
    for (let k = 0; k <= SAMPLES; k++) {
      const x = lerp(LEFT, endX, k / SAMPLES);
      edges += `${k ? "L" : "M"}${tenth(x)} ${tenth(shape.edgeY(edge, x))}`;
    }
  }
  // Stripes crowd together as the fibre shortens, which is what contracting is.
  const squeeze = (shape.cutX - LEFT) / (CUT.x - LEFT);
  for (let fibre = 0; fibre < FIBRES; fibre++) {
    const end = shape.endX(CUT.y + ((BAND_EDGES[fibre] + BAND_EDGES[fibre + 1]) / 2) * shape.ry);
    for (let rest = LEFT + STRIATION_STEP; ; rest += STRIATION_STEP) {
      const x = LEFT + (rest - LEFT) * squeeze;
      if (x > end - 1) break;
      striations += `M${tenth(x)} ${tenth(shape.edgeY(fibre, x) + 0.3)}V${tenth(shape.edgeY(fibre + 1, x) - 0.3)}`;
    }
  }
  return { edges, striations };
}

function sheathPaths(shape: Shape) {
  const side = (edge: number) => {
    let d = "";
    const endX = shape.endX(CUT.y + BAND_EDGES[edge] * shape.ry);
    for (let k = 0; k <= SAMPLES; k++) {
      const x = lerp(LEFT, shape.cutX, k / SAMPLES);
      if (x > endX && k < SAMPLES) continue;
      d += `${d ? "L" : "M"}${tenth(x)} ${tenth(shape.edgeY(edge, x))}`;
    }
    return d;
  };
  const top = side(0);
  const bottom = side(FIBRES);
  const back = bottom
    .split(/(?=[ML])/)
    .reverse()
    .map((command) => `L${command.slice(1)}`)
    .join("");
  return { lines: top + bottom, fill: `${top}${back}Z` };
}

function markPaths(shape: Shape, tears: number, repairs: number) {
  let tear = "";
  let stitch = "";
  let patch = "";
  TEAR_SITES.forEach((site, k) => {
    if (k >= tears && k >= repairs) return;
    const middleY = CUT.y + ((BAND_EDGES[site.fibre] + BAND_EDGES[site.fibre + 1]) / 2) * shape.ry;
    const x = lerp(LEFT, shape.endX(middleY), site.s);
    const top = shape.edgeY(site.fibre, x);
    const bottom = shape.edgeY(site.fibre + 1, x);
    const y = (top + bottom) / 2;
    const half = (bottom - top) / 2;
    if (k < repairs) patch += `M${tenth(x - PATCH_HALF_LENGTH)} ${tenth(top + 0.4)}H${tenth(x + PATCH_HALF_LENGTH)}V${tenth(bottom - 0.4)}H${tenth(x - PATCH_HALF_LENGTH)}Z`;
    // New protein fills a spot in quietly. Only a tear being closed needs stitches.
    if (k < repairs && k < tears) {
      for (const row of [-0.42, 0.42]) stitch += `M${tenth(x - STITCH_HALF_LENGTH)} ${tenth(y + row * half)}H${tenth(x + STITCH_HALF_LENGTH)}`;
    }
    if (k < tears) {
      tear += `M${tenth(x + site.jag[0])} ${tenth(top - 0.3)}`;
      site.jag.forEach((jag, i) => {
        tear += `L${tenth(x + jag)} ${tenth(top + ((bottom - top) * (i + 1)) / site.jag.length + (i === site.jag.length - 1 ? 0.3 : 0))}`;
      });
    }
  });
  return { tear, stitch, patch };
}

const RESTING: MuscleState = { work: 0, fatigue: 0, soreness: 0, repair: 0, glycogenUsed: 0 };

const worked = (events: BodyEvent[], muscle: MuscleGroup | null, t: number) => events.some((event) => event.from <= t && event.muscles.some((m) => m.group === muscle));

// Says what the drawing shows, so the caption and the fibres always agree.
function fibreWord(state: MuscleState, wasWorked: boolean) {
  const r = REFERENCE.muscleState;
  if (state.work >= r.workingFrom) return "working";
  if (state.soreness >= r.soreFrom) return "sore";
  if (state.repair >= r.repairingFrom) return "repairing";
  if (state.fatigue >= r.tiredFrom) return "tired";
  if (state.soreness >= MUSCLE_RECOVERY.activeAbove || state.repair >= MUSCLE_RECOVERY.activeAbove) return "nearly recovered";
  return wasWorked ? "recovered" : "rested";
}

function keyAt(shape: Shape, site: { fibre: number; s: number }) {
  const middleY = CUT.y + ((BAND_EDGES[site.fibre] + BAND_EDGES[site.fibre + 1]) / 2) * shape.ry;
  const x = lerp(LEFT, shape.endX(middleY), site.s);
  return { x, leader: `M${tenth(x)} ${tenth(shape.edgeY(site.fibre + 1, x) + 0.6)}V${KEY_LEADER_END_Y}` };
}

function createMusclePainter(art: SVGSVGElement): Painter {
  const sheathFill = part<SVGPathElement>(art, "sheath-fill");
  const sheathLines = part<SVGPathElement>(art, "sheath-lines");
  const face = part<SVGGElement>(art, "face");
  const edges = part<SVGPathElement>(art, "edges");
  const striations = part<SVGPathElement>(art, "striations");
  const patches = part<SVGPathElement>(art, "patches");
  const tears = part<SVGPathElement>(art, "tears");
  const stitches = part<SVGPathElement>(art, "stitches");
  const blood = part<SVGGElement>(art, "blood");
  const vesselBeads = part<SVGPathElement>(art, "vessel-beads");
  const tearKey = part<SVGGElement>(art, "tear-key");
  const repairKey = part<SVGGElement>(art, "repair-key");
  const sugar = parts<SVGCircleElement>(art, "sugar");

  const random = seededRandom(31);
  const sugarBorn = new Float32Array(SUGAR_POOL).fill(-Infinity);
  const sugarFrom = new Float32Array(SUGAR_POOL);
  const sugarTo = Array.from({ length: SUGAR_POOL }, () => ({ fibre: 0, s: 0.5 }));
  let nextSugar = 0;
  let due = 0;
  let repPhase = 0;
  let beadOffset = 0;
  let contraction = -1;
  let drawnKey = "";
  let shape = shapeFor(0);

  return ({ dt, clock, still }, { trajectory, t, muscle }) => {
    const state = muscle ? muscleStateAt(trajectory.muscleEvents, muscle, t) : RESTING;
    const working = state.work > WORK_MOVES_FROM;
    if (working && !still) repPhase += dt / REP_SECONDS;
    const rep = still ? STILL_REP : repPhase % 1;
    const squeeze = working ? state.work * (0.5 - 0.5 * Math.cos(rep * Math.PI * 2)) ** 1.4 : 0;
    const target = clamp01(squeeze + state.fatigue * FATIGUE_HOLD);
    contraction = still || contraction < 0 ? target : easeToward(contraction, target, dt, 14);

    const marks = (amount: number) => (amount < MUSCLE_RECOVERY.activeAbove ? 0 : Math.round(amount * MAX_MARKS));
    const tearCount = marks(state.soreness);
    const repairCount = marks(state.repair);
    const key = `${Math.round(contraction * 300)}|${tearCount}|${repairCount}`;
    if (key !== drawnKey) {
      drawnKey = key;
      shape = shapeFor(contraction);
      const fibres = fibrePaths(shape);
      const sheath = sheathPaths(shape);
      const drawn = markPaths(shape, tearCount, repairCount);
      edges.setAttribute("d", fibres.edges);
      striations.setAttribute("d", fibres.striations);
      sheathFill.setAttribute("d", sheath.fill);
      sheathLines.setAttribute("d", sheath.lines);
      face.setAttribute("transform", `translate(${tenth(shape.cutX)} ${CUT.y}) scale(1 ${Math.round((shape.ry / CUT.ry) * 1000) / 1000})`);
      tears.setAttribute("d", drawn.tear);
      stitches.setAttribute("d", drawn.stitch);
      patches.setAttribute("d", drawn.patch);
      const tearMark = keyAt(shape, KEY_SITES.tear);
      const repairMark = keyAt(shape, KEY_SITES.repair);
      const [tearLeader, tearText] = Array.from(tearKey.children);
      const [repairLeader, repairText] = Array.from(repairKey.children);
      tearLeader.setAttribute("d", tearMark.leader);
      tearText.setAttribute("x", tenth(tearMark.x));
      repairLeader.setAttribute("d", repairMark.leader);
      repairText.setAttribute("x", tenth(repairMark.x));
      tearKey.style.visibility = tearCount >= 1 ? "visible" : "hidden";
      repairKey.style.visibility = repairCount >= 2 ? "visible" : "hidden";
    }

    // The blood and its sugar are only part of the picture while the muscle is working.
    const flowing = state.work >= REFERENCE.muscleState.workingFrom;
    blood.style.opacity = flowing ? "1" : "0";
    const sugarDrive = flowing ? state.work * SUGAR_PER_SECOND : 0;
    if (flowing && !still) {
      beadOffset -= dt * lerp(4, 18, state.work);
      vesselBeads.setAttribute("stroke-dashoffset", tenth(((beadOffset % VESSEL_BEAD_PERIOD) + VESSEL_BEAD_PERIOD) % VESSEL_BEAD_PERIOD));
      due += dt * sugarDrive;
      while (due >= 1) {
        due -= 1;
        sugarBorn[nextSugar] = clock;
        sugarFrom[nextSugar] = lerp(30, 170, random());
        sugarTo[nextSugar] = { fibre: Math.floor(random() * 3), s: lerp(0.15, 0.8, random()) };
        nextSugar = (nextSugar + 1) % SUGAR_POOL;
      }
    }
    for (let k = 0; k < SUGAR_POOL; k++) {
      const age = still ? (k < sugarDrive * SUGAR_SECONDS ? ((k + 0.5) / (sugarDrive * SUGAR_SECONDS)) * SUGAR_SECONDS : Infinity) : clock - sugarBorn[k];
      if (age > SUGAR_SECONDS) {
        sugar[k].style.visibility = "hidden";
        continue;
      }
      const progress = age / SUGAR_SECONDS;
      const fromX = still ? lerp(30, 170, ((k * 5) % SUGAR_POOL) / SUGAR_POOL) : sugarFrom[k];
      const to = still ? { fibre: k % 3, s: lerp(0.15, 0.8, ((k * 3) % SUGAR_POOL) / SUGAR_POOL) } : sugarTo[k];
      const ease = smoothstep(0, 1, progress);
      const toX = lerp(LEFT, shape.cutX - CUT.rx, to.s);
      sugar[k].setAttribute("cx", tenth(lerp(fromX, toX, ease)));
      sugar[k].setAttribute("cy", tenth(lerp(VESSEL_Y(fromX), shape.edgeY(to.fibre + 1, toX) - 2, ease)));
      sugar[k].style.opacity = String(Math.round((1 - bump(progress, 1, 0.16)) * 100) / 100);
      sugar[k].style.visibility = "visible";
    }
  };
}

const Drawing = memo(function Drawing() {
  return (
    <>
      <g data-part="blood" className="muscle-blood">
        <path className="vessel-wall" d={VESSEL} />
        <path className="vessel-bore" d={VESSEL} />
        <path data-part="vessel-beads" className="vessel-beads" strokeDasharray={`0.1 ${VESSEL_BEAD_PERIOD - 0.1}`} d={VESSEL} />
        <text x="236" y="22" textAnchor="end">Sugar from your blood</text>
      </g>
      <path data-part="sheath-fill" className="fill-paper" />
      <path data-part="patches" className="muscle-patch" />
      <path data-part="striations" className="muscle-striation" />
      <path data-part="edges" className="muscle-edge" />
      <path data-part="sheath-lines" className="line-ink" />
      <g data-part="face">
        <ellipse className="muscle-face" rx={CUT.rx} ry={CUT.ry} />
        {FIBRE_ENDS.map((end, k) => (
          <ellipse key={k} className="muscle-end" cx={tenth(end.x * CUT.rx)} cy={tenth(end.y * CUT.ry)} rx={tenth(FIBRE_END_RADIUS * CUT.rx)} ry={tenth(FIBRE_END_RADIUS * CUT.ry)} />
        ))}
      </g>
      <path data-part="tears" className="muscle-tear" />
      <path data-part="stitches" className="muscle-stitch" />
      <g data-part="tear-key">
        <path className="leader" />
        <text y={KEY_TEXT_Y} textAnchor="middle" className="muscle-tear-word">Tiny tears</text>
      </g>
      <g data-part="repair-key">
        <path className="leader" />
        <text y={KEY_TEXT_Y} textAnchor="middle">Repair</text>
      </g>
      {Array.from({ length: SUGAR_POOL }, (_, k) => (
        <circle key={k} data-part="sugar" className="muscle-sugar" r="1.5" />
      ))}
    </>
  );
});

export function MuscleInset(props: InsetProps) {
  const art = useInsetPainter(createMusclePainter, props);
  const { trajectory, t, muscle } = props;
  const caption = `Muscle fibres: ${fibreWord(muscle ? muscleStateAt(trajectory.muscleEvents, muscle, t) : RESTING, worked(trajectory.muscleEvents, muscle, t))}`;
  return (
    <Plate caption={caption} describe={`A bundle of muscle fibres, cut open. Fine tears show soreness and pale patches show repair. ${caption}.`} artRef={art}>
      <Drawing />
    </Plate>
  );
}
