import { memo, useId } from "react";
import type { Levels } from "../../closeup/define";
import { STOMACH_FULL, stomachCloseup } from "../../closeup/stomach";
import { REFERENCE, STOMACH, WAVE_SPEEDUP } from "../../model/params";
import { value } from "../../model/engine/trajectory";
import { closeupInset, Look } from "./closeupInset";
import {
  bump,
  easeToward,
  lerp,
  part,
  parts,
  pointAlong,
  polyline,
  tenth,
  sampleTube,
  seededRandom,
  smoothstep,
  TubeSample,
} from "./draw";
import type { Frame, InsetProps } from "./loop";
import { setLit } from "./parts/part";
import { ART_HEIGHT, ART_WIDTH, PlateWords } from "./Plate";

type Setting = (typeof stomachCloseup.keys)[number];

// The lower stomach in figure coordinates, from where the plate crops it down to the outlet.
const LUMEN = sampleTube(
  [
    { x: 176, y: -8, r: 43 },
    { x: 179, y: 28, r: 47 },
    { x: 171, y: 70, r: 46 },
    { x: 147, y: 106, r: 37 },
    { x: 113, y: 119, r: 26 },
    { x: 87, y: 109, r: 16 },
    { x: 69, y: 93, r: 8.5 },
    { x: 58, y: 83, r: 5 },
  ],
  84,
);
const LUMEN_LAST = LUMEN.length - 1;
const DUODENUM = sampleTube(
  [
    { x: 52, y: 79, r: 7 },
    { x: 37, y: 74, r: 7.5 },
    { x: 22, y: 83, r: 7.5 },
    { x: 15, y: 104, r: 7.5 },
    { x: 15, y: 140, r: 7.5 },
    { x: 23, y: 192, r: 7.5 },
  ],
  36,
);
const OUTLET = LUMEN[LUMEN_LAST];

const WALL_THICKNESS = 3.2;
const CROP_Y = 7;
const LEVEL_FULL_Y = 15;
const BAG_EMPTY_SCALE = 0.64;
const WAVE = { from: -0.02, to: 1.04, width: 0.075, amplitudeBody: 0.1, amplitudeAntrum: 0.5 };
const GATE = { opensAt: 0.78, wideAt: 0.86, narrowsAt: 0.95, closedAt: 1, restGap: 1.1, wideGap: 6 };
const RELEASE_AT = 0.84; // the point in each wave when the outlet lets pieces go
const KCAL_PER_INSIDE_PIECE = 15;
const KCAL_PER_LEAVING_PIECE = 0.5;
const LEAVING_POOL = 12;
const LEAVING_SECONDS = 2.8;
const LEAVING_STAGGER_SECONDS = 0.13;
const STILL_WAVE_PHASE = 0.88;
const FOOD_MIN_KCAL = 5;

const WAVE_PERIOD_SECONDS = 60 / (STOMACH.slowWavesPerMin * WAVE_SPEEDUP);
const LEAVING_ROUTE = polyline([...LUMEN.slice(Math.round(LUMEN_LAST * 0.87)), ...DUODENUM]);

const PIECE_SHAPES = [
  "M-1 -.25L-.45 -.95L.55 -.85L1 .1L.5 .9L-.6 .8Z",
  "M-.9 -.6L.1 -1L1 -.4L.85 .6L-.1 1L-1 .4Z",
  "M-1 .05L-.55 -.8L.35 -.95L.95 -.2L.65 .75L-.35 .95Z",
];

interface Slot {
  u: number;
  v: number;
  size: number;
  shape: number;
  turn: number;
}

// Pieces keep their place from frame to frame, spaced so they never pile up. The low slots and the
// ones by the outlet fill first.
const SLOTS: Slot[] = (() => {
  const random = seededRandom(7);
  const accepted: (Slot & { x: number; y: number })[] = [];
  const spacing = 8.6;
  for (let attempt = 0; attempt < 9000 && accepted.length < 70; attempt++) {
    const u = lerp(0.08, 0.93, random());
    const v = lerp(-0.84, 0.84, random());
    const j = Math.round(u * LUMEN_LAST);
    const x = LUMEN[j].x + LUMEN[j].nx * LUMEN[j].r * v;
    const y = LUMEN[j].y + LUMEN[j].ny * LUMEN[j].r * v;
    if (accepted.some((a) => Math.hypot(a.x - x, a.y - y) < spacing)) continue;
    // Food is ground finer on its way to the outlet.
    const size = lerp(3.5, 1.7, smoothstep(0.55, 0.93, u)) * lerp(0.85, 1.1, random());
    accepted.push({
      u,
      v,
      size,
      shape: Math.floor(random() * PIECE_SHAPES.length),
      turn: Math.round(random() * 360),
      x,
      y,
    });
  }
  const priority = (s: { u: number; y: number }) => s.y + 46 * smoothstep(0.62, 0.84, s.u);
  return accepted.sort((a, b) => priority(b) - priority(a));
})();

function hatchLines() {
  let d = "";
  for (let y = 4; y < ART_HEIGHT; y += 3.4) d += `M0 ${tenth(y)}H${ART_WIDTH}`;
  return d;
}

function tubeWalls(tube: TubeSample[]) {
  const side = (sign: number) =>
    tube.map((p, i) => `${i ? "L" : "M"}${tenth(p.x + p.nx * p.r * sign)} ${tenth(p.y + p.ny * p.r * sign)}`).join("");
  return `${side(1)}${side(-1)}`;
}

function paintStomach(art: SVGSVGElement) {
  const lumenClip = part<SVGPathElement>(art, "lumen-clip");
  const belowClip = part<SVGPathElement>(art, "below-clip");
  const hatch = part<SVGPathElement>(art, "hatch");
  const surface = part<SVGPathElement>(art, "surface");
  const wallFill = part<SVGPathElement>(art, "wall-fill");
  const wallLines = part<SVGPathElement>(art, "wall-lines");
  const fibres = part<SVGPathElement>(art, "fibres");
  const lining = part<SVGPathElement>(art, "lining");
  const gateNear = part<SVGEllipseElement>(art, "gate-near");
  const gateFar = part<SVGEllipseElement>(art, "gate-far");
  const pieces = parts<SVGPathElement>(art, "piece");
  const leaving = parts<SVGCircleElement>(art, "leaving");
  const contents = part<SVGGElement>(art, "contents");
  const food = part<SVGGElement>(art, "food");
  const outlet = parts<SVGGElement>(art, "outlet");

  const radii = new Float32Array(LUMEN.length);
  const leavingBorn = new Float32Array(LEAVING_POOL).fill(-Infinity);
  const pieceShown = new Float32Array(SLOTS.length);
  let nextLeaving = 0;
  let phase = 0;
  let lastRelease = -1;
  let carriedKcal = 0;
  let wasLiquid: boolean | null = null;

  return ({ dt, clock, still }: Frame, { levels, lit }: Look<Setting>) => {
    const fill = levels.fullness;
    const ml = lerp(STOMACH.restingVolumeMl, STOMACH.fullnessMl, fill);
    const kcal = levels.food * STOMACH_FULL.kcal;
    const rate = levels.emptying * STOMACH_FULL.emptyingKcalPerMin;
    const foodShown = smoothstep(2, 80, kcal);
    setLit(contents, lit.fullness);
    setLit(food, lit.food);
    for (const group of outlet) setLit(group, lit.emptying);

    if (!still) phase += dt / WAVE_PERIOD_SECONDS;
    const wave = still ? STILL_WAVE_PHASE : phase % 1;
    const crest = lerp(WAVE.from, WAVE.to, wave);
    const strength = lerp(0.25, 1, foodShown);

    // Each wave delivers its share of the model's rate, in pieces of a fixed size.
    const releaseCycle = Math.floor(phase - RELEASE_AT);
    if (!still && releaseCycle > lastRelease) {
      lastRelease = releaseCycle;
      carriedKcal += rate / STOMACH.slowWavesPerMin;
      const count = Math.floor(carriedKcal / KCAL_PER_LEAVING_PIECE);
      carriedKcal -= count * KCAL_PER_LEAVING_PIECE;
      for (let i = 0; i < Math.min(count, LEAVING_POOL); i++) {
        leavingBorn[nextLeaving] = clock + i * LEAVING_STAGGER_SECONDS;
        nextLeaving = (nextLeaving + 1) % LEAVING_POOL;
      }
    }

    const drive = Math.max(smoothstep(0, 3, rate), 0.5 * smoothstep(55, 120, ml));
    const open = smoothstep(GATE.opensAt, GATE.wideAt, wave) * (1 - smoothstep(GATE.narrowsAt, GATE.closedAt, wave));
    const gap = GATE.restGap + (GATE.wideGap - GATE.restGap) * open * drive;

    const bagScale = lerp(BAG_EMPTY_SCALE, 1, Math.sqrt(fill));
    let bottomY = 0;
    for (let j = 0; j <= LUMEN_LAST; j++) {
      const u = j / LUMEN_LAST;
      const squeeze =
        (WAVE.amplitudeBody + (WAVE.amplitudeAntrum - WAVE.amplitudeBody) * smoothstep(0.3, 0.92, u)) *
        strength *
        bump(u, crest, WAVE.width);
      const r = LUMEN[j].r * lerp(bagScale, 1, smoothstep(0.62, 0.88, u)) * (1 - squeeze);
      radii[j] = lerp(r, gap, smoothstep(0.9, 0.985, u));
      bottomY = Math.max(bottomY, LUMEN[j].y + Math.abs(LUMEN[j].ny) * radii[j]);
    }

    let nearOuter = "";
    let farOuter = "";
    let nearInner = "";
    let farInner = "";
    let fibrePath = "";
    let liningPath = "";
    const farOuterBack: string[] = [];
    const farInnerBack: string[] = [];
    for (let j = 0; j <= LUMEN_LAST; j++) {
      const p = LUMEN[j];
      const u = j / LUMEN_LAST;
      const r = radii[j];
      const thick = WALL_THICKNESS + 2.8 * bump(u, crest, WAVE.width) * strength * smoothstep(0.2, 0.7, u);
      const command = j ? "L" : "M";
      const nearOutX = tenth(p.x + p.nx * (r + thick));
      const nearOutY = tenth(p.y + p.ny * (r + thick));
      const nearInX = tenth(p.x + p.nx * r);
      const nearInY = tenth(p.y + p.ny * r);
      const farOutX = tenth(p.x - p.nx * (r + thick));
      const farOutY = tenth(p.y - p.ny * (r + thick));
      const farInX = tenth(p.x - p.nx * r);
      const farInY = tenth(p.y - p.ny * r);
      nearOuter += `${command}${nearOutX} ${nearOutY}`;
      farOuter += `${command}${farOutX} ${farOutY}`;
      nearInner += `${command}${nearInX} ${nearInY}`;
      farInner += `${command}${farInX} ${farInY}`;
      farOuterBack.push(`L${farOutX} ${farOutY}`);
      farInnerBack.push(`L${farInX} ${farInY}`);
      if (j % 2 === 0)
        fibrePath += `M${nearOutX} ${nearOutY}L${nearInX} ${nearInY}M${farOutX} ${farOutY}L${farInX} ${farInY}`;
      // Folds of the lining run along the outer wall and stand out more when the bag is slack.
      if (j % 4 === 0 && u < 0.86) {
        const fold = 1 + 1.6 * (1 - fill);
        const next = LUMEN[Math.min(LUMEN_LAST, j + 4)];
        const nextR = radii[Math.min(LUMEN_LAST, j + 4)];
        liningPath += `M${nearInX} ${nearInY}Q${tenth(p.x + p.nx * (r - fold))} ${tenth(p.y + p.ny * (r - fold))} ${tenth(next.x + next.nx * nextR)} ${tenth(next.y + next.ny * nextR)}`;
      }
    }
    farOuterBack.reverse();
    farInnerBack.reverse();
    const lumenPath = `${nearInner}${farInnerBack.join("")}Z`;
    lumenClip.setAttribute("d", lumenPath);
    wallFill.setAttribute("d", `${nearOuter}${farOuterBack.join("")}Z${lumenPath}`);
    wallLines.setAttribute("d", `${nearOuter}${farOuter}${nearInner}${farInner}`);
    fibres.setAttribute("d", fibrePath);
    lining.setAttribute("d", liningPath);

    // The surface stays level and moves only as the volume changes, with a slight ripple.
    const levelY = Math.max(LEVEL_FULL_Y, lerp(bottomY - 3, LEVEL_FULL_Y, fill ** 0.62));
    let surfacePath = "";
    for (let x = 0; x <= ART_WIDTH; x += 8) {
      const ripple = still ? 0 : 0.5 * Math.sin(x * 0.16 + clock * 1.6) * Math.min(1, fill * 4);
      surfacePath += `${x ? "L" : "M"}${x} ${tenth(levelY + ripple)}`;
    }
    surface.setAttribute("d", surfacePath);
    belowClip.setAttribute("d", `${surfacePath}L${ART_WIDTH} ${ART_HEIGHT}L0 ${ART_HEIGHT}Z`);

    const liquid = kcal <= FOOD_MIN_KCAL;
    if (liquid !== wasLiquid) {
      wasLiquid = liquid;
      hatch.toggleAttribute("data-liquid", liquid);
      surface.toggleAttribute("data-liquid", liquid);
    }

    const wanted = Math.round(kcal / KCAL_PER_INSIDE_PIECE);
    SLOTS.forEach((slot, k) => {
      const pushed = slot.u + 0.022 * strength * bump(slot.u, crest, WAVE.width * 1.2);
      const position = pushed * LUMEN_LAST;
      const j = Math.min(LUMEN_LAST - 1, Math.floor(position));
      const f = position - j;
      const a = LUMEN[j];
      const b = LUMEN[j + 1];
      const r = lerp(radii[j], radii[j + 1], f) * slot.v;
      const x = lerp(a.x + a.nx * r, b.x + b.nx * r, f);
      const y = lerp(a.y + a.ny * r, b.y + b.ny * r, f);
      const target = k < wanted && y > levelY + 2 ? 1 : 0;
      pieceShown[k] = still ? target : easeToward(pieceShown[k], target, dt, 9);
      const scale = slot.size * pieceShown[k];
      pieces[k].setAttribute(
        "transform",
        `translate(${tenth(x)} ${tenth(y)}) rotate(${slot.turn}) scale(${Math.round(scale * 100) / 100})`,
      );
      pieces[k].style.visibility = scale < 0.05 ? "hidden" : "visible";
    });

    const stillCount = Math.round(rate / STOMACH.slowWavesPerMin / KCAL_PER_LEAVING_PIECE);
    for (let k = 0; k < LEAVING_POOL; k++) {
      const age = still
        ? k < stillCount
          ? ((k + 0.5) / stillCount) * LEAVING_SECONDS
          : Infinity
        : clock - leavingBorn[k];
      if (age < 0 || age > LEAVING_SECONDS) {
        leaving[k].style.visibility = "hidden";
        continue;
      }
      const along = pointAlong(LEAVING_ROUTE, 1 - (1 - age / LEAVING_SECONDS) ** 1.7);
      leaving[k].setAttribute("cx", tenth(along.x));
      leaving[k].setAttribute("cy", tenth(along.y));
      leaving[k].style.visibility = "visible";
    }

    const gateOffset = gap + 3;
    const angle = Math.round((Math.atan2(OUTLET.ny, OUTLET.nx) * 180) / Math.PI);
    gateNear.setAttribute(
      "transform",
      `translate(${tenth(OUTLET.x + OUTLET.nx * gateOffset)} ${tenth(OUTLET.y + OUTLET.ny * gateOffset)}) rotate(${angle})`,
    );
    gateFar.setAttribute(
      "transform",
      `translate(${tenth(OUTLET.x - OUTLET.nx * gateOffset)} ${tenth(OUTLET.y - OUTLET.ny * gateOffset)}) rotate(${angle})`,
    );
  };
}

const Drawing = memo(function Drawing() {
  const id = useId();
  const clip = { lumen: `${id}lumen`, below: `${id}below`, crop: `${id}crop` };
  return (
    <>
      <defs>
        <clipPath id={clip.lumen}>
          <path data-part="lumen-clip" />
        </clipPath>
        <clipPath id={clip.below}>
          <path data-part="below-clip" />
        </clipPath>
        <clipPath id={clip.crop}>
          <rect x="0" y={CROP_Y} width={ART_WIDTH} height={ART_HEIGHT - CROP_Y} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip.crop})`}>
        <path className="line-soft" d={tubeWalls(DUODENUM)} />
        <g data-part="contents" clipPath={`url(#${clip.lumen})`}>
          <g clipPath={`url(#${clip.below})`}>
            <path data-part="hatch" className="stomach-hatch" d={hatchLines()} />
          </g>
          <path data-part="surface" className="stomach-surface" />
        </g>
        <g data-part="food">
          {SLOTS.map((slot, k) => (
            <path key={k} data-part="piece" className="stomach-piece" d={PIECE_SHAPES[slot.shape]} />
          ))}
        </g>
        <path data-part="wall-fill" className="fill-paper" fillRule="evenodd" />
        <path data-part="fibres" className="stomach-fibres" />
        <path data-part="lining" className="stomach-lining" />
        <path data-part="wall-lines" className="line-ink" />
        <g data-part="outlet">
          {Array.from({ length: LEAVING_POOL }, (_, k) => (
            <circle key={k} data-part="leaving" className="stomach-leaving" r="1.6" />
          ))}
          <ellipse data-part="gate-near" className="stomach-gate" rx="3.6" ry="3" />
          <ellipse data-part="gate-far" className="stomach-gate" rx="3.6" ry="3" />
        </g>
      </g>
      <g data-part="outlet">
        <path className="leader" d={`M${OUTLET.x} 62V${OUTLET.y - 11}`} />
        <text x={OUTLET.x} y="58" textAnchor="middle">
          Outlet
        </text>
        <text x="29" y="150">
          To intestine
        </text>
      </g>
    </>
  );
});

function leavingLabel(rate: number, kcal: number, ml: number) {
  if (rate >= 0.5) return `Leaving: ${Math.max(1, Math.round(rate))} kcal a minute`;
  if (kcal > FOOD_MIN_KCAL) return "Mixing: nothing leaving yet";
  return ml > STOMACH.restingVolumeMl + REFERENCE.stomach.emptyAboveRestingMl ? "Leaving: liquid" : "Empty";
}

function useStomachPlate({ trajectory, t }: InsetProps, _levels: Levels<Setting>): PlateWords {
  const caption = leavingLabel(
    value(trajectory, "emptyingKcalPerMin", t),
    value(trajectory, "stomachKcal", t),
    value(trajectory, "stomachMl", t),
  );
  return {
    caption,
    note: { text: `Shown ${WAVE_SPEEDUP}× faster` },
    describe: `A cross-section of the lower stomach and its outlet. ${caption}.`,
  };
}

export const StomachInset = closeupInset(stomachCloseup, {
  Drawing,
  paint: paintStomach,
  usePlate: useStomachPlate,
  captionFromModel: true,
});
