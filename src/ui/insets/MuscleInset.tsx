import { memo } from "react";
import { muscleCloseup } from "../../closeup/muscle";
import { BodyEvent, muscleStateAt, MuscleState } from "../../model/events";
import type { MuscleGroup } from "../../model/muscleGroups";
import { MUSCLE_RECOVERY, REFERENCE } from "../../model/params";
import { chartOffsetHours, useStore } from "../../store";
import { closeupInset, Look } from "./closeupInset";
import { lerp, part, parts, smoothstep, tenth } from "./draw";
import type { Frame, InsetProps } from "./loop";
import { nerve } from "./parts/nerve";
import { setLit, setShown, setWord } from "./parts/part";
import { Tag } from "./parts/Tag";
import { vessel } from "./parts/vessel";
import { ART_WIDTH, PlateWords } from "./Plate";
import { createStream, Placer } from "./stream";

type Setting = (typeof muscleCloseup.keys)[number];

const FIBRE = { count: 4, firstY: 64, stepY: 24, half: 10, band: 7, wave: 1.2, edgeStep: 16, margin: 16 };
const SPREAD = 3.5; // how far swelling moves each fibre, per place from the middle
const CONTRACTS = { shorter: 0.08, thicker: 0.1, secondsPerRep: 2.6 };
const IMMUNE = { pool: 12, perTear: 2, besideTear: 5.5, journeySeconds: 4, rollsFrom: 50, inBloodUntil: 0.45 };
const SUGAR = { pool: 12, seconds: 1.7, mostPerSecond: 4.2 };
const WORKING_FROM = REFERENCE.muscleState.workingFrom;

// In the order they open, so more tears only ever add. The last one is the first rebuilt.
const SITES = [
  { fibre: 0, x: 44 },
  { fibre: 1, x: 150 },
  { fibre: 2, x: 58 },
  { fibre: 3, x: 176 },
  { fibre: 0, x: 122 },
  { fibre: 2, x: 206 },
  { fibre: 1, x: 86 },
  { fibre: 3, x: 34 },
  { fibre: 0, x: 198 },
  { fibre: 1, x: 24 },
  { fibre: 2, x: 130 },
  { fibre: 3, x: 104 },
];
const [FIRST_TEAR, TEAR_WITH_CELLS] = SITES;
const FIRST_REBUILT = SITES[SITES.length - 1];

const BLOOD = vessel({ id: "blood", radius: 6.5, points: [[-10, 36], [40, 33], [110, 37], [180, 32], [250, 35]] });
const PAIN = nerve({
  id: "pain",
  points: [[-10, 161], [60, 158], [120, 164], [180, 159], [250, 161]],
  endings: [
    { x: 60, tip: [40, 149] },
    { x: 130, tip: [112, 149] },
    { x: 200, tip: [182, 149] },
  ],
});

const fibreY = (fibre: number) => FIBRE.firstY + fibre * FIBRE.stepY;
const spreadOf = (fibre: number) => (fibre - (FIBRE.count - 1) / 2) * SPREAD;

const BANDS = (() => {
  let d = "";
  for (let x = -FIBRE.margin; x <= ART_WIDTH + FIBRE.margin; x += FIBRE.band) d += `M${x} ${-FIBRE.half + 2}V${FIBRE.half - 2}`;
  return d;
})();

// A fibre's edge, a little uneven, so it reads as tissue and not as a ruled line.
function fibreShape(fibre: number) {
  const edge = (side: 1 | -1, phase: number) => {
    const points: string[] = [];
    for (let x = -FIBRE.margin; x <= ART_WIDTH + FIBRE.margin; x += FIBRE.edgeStep) points.push(`${x} ${tenth(side * FIBRE.half + Math.sin(x / 26 + phase) * FIBRE.wave)}`);
    return points;
  };
  return `M${[...edge(-1, fibre * 1.7), ...edge(1, fibre * 2.3 + 1).reverse()].join("L")}Z`;
}

// A crack: both sides zigzag the same way, as if they had just pulled apart.
const BREAK = "M-3 -11L-1 -6.5L-4 -2.5L-1 1.5L-3 6L-1.5 11L3 11L1.5 6L4 1.5L1 -2.5L4 -6.5L1.5 -11Z";
// New tissue, swelling out of the fibre's edge and back into it.
const BULGE = "M-24 0C-13.5 -1 -10 -13 0 -13C10 -13 13.5 -1 24 0C13.5 1 10 13 0 13C-10 13 -13.5 1 -24 0Z";
const FLUID_TOP = fibreY(0) - FIBRE.half + 2; // always hidden behind the outer fibres, wherever swelling has moved them
const FLUID_BOTTOM = fibreY(FIBRE.count - 1) + FIBRE.half - 2;

const Drawing = memo(function Drawing() {
  return (
    <>
      <rect data-part="fluid" className="fibre-fluid" x="-10" y={FLUID_TOP} width={ART_WIDTH + 20} height={FLUID_BOTTOM - FLUID_TOP} />
      <PAIN.Art />
      <BLOOD.Art />
      <Tag part="blood-tag" x={ART_WIDTH - 8} y={21} anchor="end">Blood vessel</Tag>
      <Tag part="sugar-tag" x={ART_WIDTH - 8} y={21} anchor="end">Sugar from your blood</Tag>
      {Array.from({ length: FIBRE.count }, (_, fibre) => (
        <g key={fibre} data-part="fibre" transform={`translate(0 ${fibreY(fibre)})`}>
          <g data-part="tissue">
            <path className="fibre-body" d={fibreShape(fibre)} />
            <path className="fibre-band" data-part="bands" d={BANDS} />
          </g>
          {SITES.flatMap((site, i) =>
            site.fibre === fibre
              ? [
                  <path key={`new${i}`} data-part="rebuilt" data-site={i} className="fibre-rebuilt" transform={`translate(${site.x} 0)`} d={BULGE} />,
                  <path key={`tear${i}`} data-part="tear" data-site={i} className="fibre-tear" transform={`translate(${site.x} 0)`} d={BREAK} />,
                ]
              : [],
          )}
          {fibre === FIRST_TEAR.fibre ? <Tag part="tear-tag" x={FIRST_TEAR.x + 12} y={0}>A tear</Tag> : null}
          {fibre === TEAR_WITH_CELLS.fibre ? <Tag part="immune-tag" x={TEAR_WITH_CELLS.x + 12} y={0}>Immune cells</Tag> : null}
          {fibre === FIRST_REBUILT.fibre ? <Tag part="rebuilt-tag" x={FIRST_REBUILT.x - 26} y={0} anchor="end">Rebuilt</Tag> : null}
        </g>
      ))}
      <Tag part="pain-tag" x={ART_WIDTH - 8} y={172} anchor="end">Pain signal, to your brain ›</Tag>
      {Array.from({ length: SUGAR.pool }, (_, k) => <circle key={k} data-part="sugar" className="fibre-sugar" r="1.4" />)}
      {Array.from({ length: IMMUNE.pool }, (_, k) => (
        <g key={k} data-part="immune">
          <circle className="immune-cell" r="4.4" />
          <circle className="immune-nucleus" cx="-1.3" cy="-0.8" r="1.1" />
          <circle className="immune-nucleus" cx="1.2" cy="-1" r="1" />
          <circle className="immune-nucleus" cx="0.1" cy="1.3" r="1" />
        </g>
      ))}
    </>
  );
});

function paintMuscle(art: SVGSVGElement) {
  const fibres = parts<SVGGElement>(art, "fibre");
  const tissue = parts<SVGGElement>(art, "tissue");
  const bands = parts<SVGPathElement>(art, "bands");
  const fluid = part<SVGRectElement>(art, "fluid");
  const tears = parts<SVGPathElement>(art, "tear").sort((a, b) => Number(a.dataset.site) - Number(b.dataset.site));
  const rebuilt = parts<SVGPathElement>(art, "rebuilt").sort((a, b) => Number(a.dataset.site) - Number(b.dataset.site));
  const tag = (name: string) => part<SVGTextElement>(art, `${name}-tag`);
  const tags = { blood: tag("blood"), sugar: tag("sugar"), tear: tag("tear"), immune: tag("immune"), rebuilt: tag("rebuilt"), pain: tag("pain") };
  const immune = parts<SVGGElement>(art, "immune");
  const journeys = new Float32Array(IMMUNE.pool); // 0 is still in the blood, 1 has settled at its tear
  const paintBlood = BLOOD.attach(art);
  const paintPain = PAIN.attach(art);
  const sugar = createStream(parts(art, "sugar"), SUGAR.seconds, 31);
  let swelling = 0;

  const onScreen = (site: (typeof SITES)[number]) => ({ x: site.x, y: fibreY(site.fibre) + spreadOf(site.fibre) * swelling });
  const toMuscle: Placer = (progress, seat) => {
    const x = lerp(20, 220, (seat * 7) % 1);
    const y = fibreY(Math.floor(seat * FIBRE.count)) + spreadOf(Math.floor(seat * FIBRE.count)) * swelling;
    return { x, y: lerp(BLOOD.centerAt(x), y, smoothstep(0, 1, progress)), opacity: 1 - smoothstep(0.8, 1, progress) };
  };

  // How many immune cells are at the tears is the level, so moving through time shows them gather and leave.
  // Each has its own tear: it rolls along inside the vessel, crosses the wall above the tear, and settles.
  const paintImmune = (frame: Frame, arrived: number, open: number, lit: number) => {
    immune.forEach((cell, k) => {
      const tear = Math.floor(k / IMMUNE.perTear);
      const wanted = k < arrived * IMMUNE.pool && tear < open ? 1 : 0;
      const step = frame.dt / IMMUNE.journeySeconds;
      journeys[k] = frame.still ? wanted : wanted > journeys[k] ? Math.min(wanted, journeys[k] + step) : Math.max(wanted, journeys[k] - step);
      const journey = journeys[k];
      const to = onScreen(SITES[tear]);
      const x = to.x + (k % IMMUNE.perTear ? IMMUNE.besideTear : -IMMUNE.besideTear);
      const rolled = lerp(x - IMMUNE.rollsFrom, x, journey / IMMUNE.inBloodUntil);
      const at = journey < IMMUNE.inBloodUntil ? { x: rolled, y: BLOOD.centerAt(rolled) } : { x, y: lerp(BLOOD.centerAt(x), to.y, smoothstep(IMMUNE.inBloodUntil, 1, journey)) };
      const settled = journey === 1 && !frame.still ? 1 : 0;
      cell.setAttribute("transform", `translate(${tenth(at.x + settled * Math.sin(frame.clock * 1.1 + k))} ${tenth(at.y + settled * Math.cos(frame.clock * 0.9 + k * 2))})`);
      setShown(cell, journey * 12, lit);
    });
  };

  return (frame: Frame, { levels, lit }: Look<Setting>) => {
    swelling = levels.swelling;
    const open = levels.tears * SITES.length;
    const beat = frame.still ? 0.5 : 0.5 + 0.5 * Math.sin((frame.clock * Math.PI * 2) / CONTRACTS.secondsPerRep);
    const working = levels.work * beat;
    const thicker = (1 + CONTRACTS.thicker * working).toFixed(3);
    fibres.forEach((group, fibre) => group.setAttribute("transform", `translate(0 ${tenth(fibreY(fibre) + spreadOf(fibre) * swelling)}) scale(1 ${thicker})`));
    const shorter = 1 - CONTRACTS.shorter * working;
    for (const band of bands) band.setAttribute("transform", `translate(${tenth((ART_WIDTH / 2) * (1 - shorter))} 0) scale(${shorter.toFixed(3)} 1)`);
    const tissueLit = Math.max(lit.work, lit.tears, lit.rebuilt, lit.swelling);
    for (const group of tissue) setLit(group, tissueLit);
    setShown(fluid, swelling, lit.swelling);
    // Tears close from the last one back, and rebuilding takes over from that same end, so one site is
    // never both at once.
    SITES.forEach((_, i) => {
      setShown(tears[i], open - i, lit.tears);
      setShown(rebuilt[i], levels.rebuilt * SITES.length - (SITES.length - 1 - i), lit.rebuilt);
    });
    const sugarFlows = levels.work >= WORKING_FROM ? levels.work : 0;
    paintBlood(frame, { lit: Math.max(levels.immune * lit.immune, sugarFlows * lit.work) });
    paintPain(frame, { signal: levels.pain * lit.pain });
    paintImmune(frame, levels.immune, open, lit.immune);
    sugar(frame, sugarFlows * lit.work * SUGAR.mostPerSecond, toMuscle);
    setWord(tags.blood, 1 - sugarFlows * 4);
    setWord(tags.sugar, sugarFlows * 4, lit.work);
    setWord(tags.tear, open, lit.tears);
    setWord(tags.immune, levels.immune * 3, lit.immune);
    setWord(tags.rebuilt, levels.rebuilt * SITES.length, lit.rebuilt);
    setWord(tags.pain, levels.pain * 3, lit.pain);
  };
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

const awayWords = (hours: number) => {
  const away = Math.abs(hours);
  const span = away < 48 ? `${away} hours` : `${Math.round(away / 24)} days`;
  return hours < 0 ? `${span} earlier` : `${span} later`;
};

function useMusclePlate({ trajectory, t, muscle }: InsetProps): PlateWords {
  const away = useStore(chartOffsetHours);
  const word = fibreWord(muscle ? muscleStateAt(trajectory.muscleEvents, muscle, t) : RESTING, worked(trajectory.muscleEvents, muscle, t));
  const caption = `Muscle fibres: ${word}`;
  return { caption, note: away === null ? undefined : { text: awayWords(away) }, describe: `Muscle fibres with a blood vessel above them and a nerve below. ${caption}.` };
}

export const MuscleInset = closeupInset(muscleCloseup, { Drawing, paint: paintMuscle, usePlate: useMusclePlate });
