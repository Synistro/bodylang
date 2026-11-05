import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Levels, levelsAt, Travel } from "../closeup/define";
import { closeupOf } from "../closeup/list";
import type { OrganId } from "../model/simulate";
import type { AnchorId, Stage } from "../scene/stage";
import { closeupOnScreen, useStore } from "../store";
import { useFrame, useMuscleMinute } from "./hooks";
import { along, createStream, curve } from "./insets/stream";

const CURVE_SAMPLES = 40;
const BEADS = { pool: 12, seconds: 3.6, mostPerSecond: 3.4, r: 2.6 };
const PANEL_GAP_PX = 6;

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

// The body's half of a walkthrough step: where the close-up beside it is looking, and what travels.
export function BodyTrace({ stage }: { stage: Stage }) {
  const step = useStore(closeupOnScreen);
  const muscle = useStore((s) => s.body.focusMuscle);
  const trajectory = useStore((s) => s.trajectory);
  const minute = useMuscleMinute();
  const closeup = step ? closeupOf(step.organ) : null;
  const here: AnchorId | null = step?.organ === "muscle" ? (muscle ? `muscle:${muscle}` : null) : (step?.organ ?? null);
  if (!step || !closeup || !here) return null;

  const levels: Levels = levelsAt(closeup.keys, closeup.fromModel, { trajectory, muscle }, minute, { light: step.light, set: step.set, times: {} });
  // One route at a time, the first thing the step names: they share the trunk, and two would read as one.
  const travelling = step.light.find((key) => closeup.travels[key]);
  return (
    <svg className="body-trace" aria-hidden="true">
      <PanelLink stage={stage} here={here} />
      {travelling ? <TravelLine key={travelling} stage={stage} travel={closeup.travels[travelling]!} here={here} amount={levels[travelling]} /> : null}
    </svg>
  );
}
