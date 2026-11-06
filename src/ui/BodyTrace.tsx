import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Levels, levelsAt, Travel } from "../closeup/define";
import { closeupOf } from "../closeup/list";
import { actingAt } from "../model/acting";
import type { EventTrack, TrackFrom } from "../model/events/types";
import type { OrganId } from "../model/ids";
import type { AnchorId, Stage } from "../scene/stage";
import { stepOnScreen, trackOnScreen, useStore } from "../store";
import { useFrame, useMuscleMinute } from "./hooks";
import { along, createStream, curve } from "./insets/stream";

const CURVE_SAMPLES = 40;
const BEADS = { pool: 12, seconds: 3.6, mostPerSecond: 3.4, r: 2.6 };
const PANEL_GAP_PX = 6;

const OFF_SCREEN_LINE_OPACITY = 0.25;
const onScreen = ([x, y]: [number, number]) => x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;

const stillMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// What a lit level sends across the body, drawn over the figure so it stays on it as the camera moves.
function TravelLine({ stage, travel, here, amount }: { stage: Stage; travel: Travel; here: AnchorId; amount: number }) {
  const line = useRef<SVGPathElement>(null);
  const beads = useRef<SVGGElement>(null);
  const stream = useRef<ReturnType<typeof createStream> | null>(null);
  const clock = useRef(0);
  const world = useMemo(() => new THREE.Vector3(), []);
  const anchor = (end: "here" | OrganId) => (end === "here" ? here : end);

  useFrame(stage, (s, dt) => {
    if (!line.current || !beads.current) return;
    const place = (at: THREE.Vector3): [number, number] => {
      const { x, y } = s.project(at);
      return [x, y];
    };
    const points = [place(s.anchorOf(anchor(travel.from), world)), ...travel.through.map((joint) => place(s.jointAt(joint, world))), place(s.anchorOf(anchor(travel.to), world))];
    const { d, route } = curve(points, CURVE_SAMPLES);
    line.current.setAttribute("d", d);
    // With a far end off screen, a full-strength stroke would read as a stray line across the body.
    line.current.style.opacity = points.every(onScreen) ? "" : String(OFF_SCREEN_LINE_OPACITY);
    stream.current ??= createStream(Array.from(beads.current.children) as SVGCircleElement[], BEADS.seconds, 3);
    clock.current += dt;
    stream.current({ dt, clock: clock.current, still: stillMotion() }, amount * BEADS.mostPerSecond, along(route));
  });

  return (
    <g className="body-travel" data-kind={travel.kind}>
      <path ref={line} />
      <g ref={beads}>
        {Array.from({ length: BEADS.pool }, (_, k) => (
          <circle key={k} r={BEADS.r} />
        ))}
      </g>
    </g>
  );
}

// A hairline from the spot on the body to its close-up, so the panel reads as that spot, magnified.
function PanelLink({ stage, here }: { stage: Stage; here: AnchorId }) {
  const line = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const world = useMemo(() => new THREE.Vector3(), []);

  useFrame(stage, (s) => {
    if (!line.current || !dot.current) return;
    const spot = s.project(s.anchorOf(here, world));
    const panel = document.querySelector(".organ-card .inset-art")?.getBoundingClientRect();
    const shown = panel !== undefined && !spot.behind;
    line.current.style.visibility = dot.current.style.visibility = shown ? "visible" : "hidden";
    if (!shown) return;
    const x = panel.left - PANEL_GAP_PX;
    const y = panel.top + panel.height / 2;
    const middle = (spot.x + x) / 2;
    line.current.setAttribute("d", `M${spot.x.toFixed(1)} ${spot.y.toFixed(1)}C${middle.toFixed(1)} ${spot.y.toFixed(1)} ${middle.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`);
    dot.current.setAttribute("cx", spot.x.toFixed(1));
    dot.current.setAttribute("cy", spot.y.toFixed(1));
  });

  return (
    <g className="body-link">
      <path ref={line} />
      <circle ref={dot} r="3" />
    </g>
  );
}

const TRACK = {
  reach: { front: 0.14, back: 0.14, left: 0.24, right: 0.24, above: 0.3, below: 0.3 } satisfies Record<TrackFrom, number>,
  heading: { front: [0, 0, -1], back: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0], above: [0, -1, 0], below: [0, 1, 0] } satisfies Record<TrackFrom, number[]>,
  wordOffPx: 9,
};

// An injury's straight line through the body, with a mark on each organ it really crosses.
function TrackLine({ stage, track }: { stage: Stage; track: EventTrack }) {
  const line = useRef<SVGPathElement>(null);
  const marks = useRef<SVGGElement>(null);
  const crossed = useMemo(() => (track.crossed ?? []).filter((part) => part.organ !== null), [track]);
  const world = useMemo(() => ({ center: new THREE.Vector3(), start: new THREE.Vector3(), end: new THREE.Vector3(), organ: new THREE.Vector3(), direction: new THREE.Vector3(...TRACK.heading[track.from]) }), [track.from]);

  useFrame(stage, (s) => {
    if (!line.current || !marks.current) return;
    s.anchorOf(track.aim, world.center);
    const reach = TRACK.reach[track.from];
    const start = s.project(world.start.copy(world.center).addScaledVector(world.direction, -reach));
    const end = s.project(world.end.copy(world.center).addScaledVector(world.direction, reach));
    line.current.setAttribute("d", `M${start.x.toFixed(1)} ${start.y.toFixed(1)}L${end.x.toFixed(1)} ${end.y.toFixed(1)}`);
    crossed.forEach((part, i) => {
      const mark = marks.current?.children[i];
      if (!mark || !part.organ) return;
      s.anchorOf(part.organ, world.organ);
      const along = world.organ.sub(world.center).dot(world.direction);
      const at = s.project(world.organ.copy(world.center).addScaledVector(world.direction, along));
      mark.setAttribute("transform", `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
    });
  });

  return (
    <g className="body-track">
      <path ref={line} />
      <g ref={marks}>
        {crossed.map((part) => (
          <g key={part.name}>
            <circle r="3.5" />
            <text x={TRACK.wordOffPx} dominantBaseline="central">
              {part.name[0].toUpperCase() + part.name.slice(1)}
            </text>
          </g>
        ))}
      </g>
    </g>
  );
}

// The body's half of a walkthrough step: where the close-up beside it is looking, and what travels.
export function BodyTrace({ stage }: { stage: Stage }) {
  const step = useStore(stepOnScreen);
  const track = useStore(trackOnScreen);
  const muscle = useStore((s) => s.view.focusMuscle);
  const trajectory = useStore((s) => s.trajectory);
  const minute = useMuscleMinute();
  const organ = step?.organ ?? null;
  const closeup = organ ? closeupOf(organ) : null;
  const here: AnchorId | null = organ === "muscle" ? (muscle ? `muscle:${muscle}` : null) : organ;

  // What travels here: the process the step is about, or the first thing it lights that has a way of its own.
  const travel = useMemo((): { key: string; travel: Travel; amount: number } | null => {
    if (!step || !organ) return null;
    if (step.process) {
      const about = actingAt(trajectory, minute, organ).find((acting) => acting.process.id === step.process);
      if (about?.from) return { key: step.process, travel: { kind: about.process.substance === "chyme" ? "food" : "blood", from: about.from, through: [], to: "here" }, amount: about.strength };
    }
    const directed = step.closeup;
    if (!directed || !closeup) return null;
    const key = directed.light.find((level) => closeup.travels[level]);
    if (!key) return null;
    const levels: Levels = levelsAt(closeup.keys, closeup.fromModel, { trajectory, muscle }, minute, { light: directed.light, set: directed.set, times: {} });
    return { key, travel: closeup.travels[key]!, amount: levels[key] };
  }, [step, organ, closeup, trajectory, muscle, minute]);

  const pointsAtPanel = here !== null && (step?.closeup || step?.composed);
  if (!pointsAtPanel && !track) return null;
  return (
    <svg className="body-trace" aria-hidden="true">
      {track ? <TrackLine stage={stage} track={track} /> : null}
      {pointsAtPanel ? <PanelLink stage={stage} here={here} /> : null}
      {travel && here ? <TravelLine key={travel.key} stage={stage} travel={travel.travel} here={here} amount={travel.amount} /> : null}
    </svg>
  );
}
