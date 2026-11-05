import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { MUSCLE_GROUPS, MUSCLE_LABEL, MuscleGroup } from "../model/muscleGroups";
import type { ProcessStop } from "../model/processes";
import type { OrganId } from "../model/simulate";
import type { AnchorId, Stage } from "../scene/stage";
import { getState, selectedProcess, setUi, useStore } from "../store";
import { freeArea } from "./freeArea";
import { organHover, rootRem, useFrame, useMinute } from "./hooks";
import { showMuscle, showOrgan } from "./navigation";
import { isOrganId, ORGAN_NAME } from "./organ";

const MOST_NAMES = 6;
const LIT_CHECK_EVERY_FRAMES = 10;
const NAME_ROW_REM = 2.2;
const NUMBER_ROW_REM = 2.5;
const LEADER_GAP_REM = 0.5;
const EDGE_REM = 0.4;
const SIDE_STICKINESS_REM = 3;
const SETTLE_PER_SECOND = 9;
const NAME_FLIP_REM = 18;
// How far each column of keys stands off the panels. Names need more, so they never read as part of a rail row.
const NAME_OFFSET_REM = 1.6;
const NUMBER_OFFSET_REM = 0.8;

type Side = "left" | "right";

const muscleOf = (id: string): MuscleGroup | null => MUSCLE_GROUPS.find((group) => `muscle:${group}` === id) ?? null;

interface KeyPlace {
  id: string;
  anchorX: number;
  anchorY: number;
  behind: boolean;
  side: Side;
  y: number;
}

// Keeps a column of keys in anchor order, a row apart, within the space the panels leave. Sorted by
// where they point, so their leaders don't cross.
function stackColumn(column: KeyPlace[], row: number, top: number, bottom: number) {
  column.sort((a, b) => a.anchorY - b.anchorY);
  let floor = top;
  for (const key of column) {
    key.y = Math.max(floor, Math.min(bottom, key.anchorY));
    floor = key.y + row;
  }
  let ceiling = bottom;
  for (let i = column.length - 1; i >= 0; i--) {
    column[i].y = Math.min(column[i].y, ceiling);
    ceiling = column[i].y - row;
  }
}

interface Handles {
  key: HTMLElement;
  leader: SVGLineElement | null;
  dot: SVGCircleElement | null;
}

// The way an atlas keys a plate: names or numbers stand in the margins beside the figure, each on a
// hairline to what it means. React decides which exist; each frame writes where they are to the DOM.
function useMarginLayout<Id extends string>(stage: Stage, ids: Id[], locate: (id: Id, stage: Stage, out: THREE.Vector3) => THREE.Vector3, rowRem: number, offsetRem: number) {
  const root = useRef<HTMLDivElement>(null);
  const sides = useRef(new Map<string, Side>());
  const shownY = useRef(new Map<string, number>());
  const margins = useRef({ left: 0, right: 0 });
  const world = useMemo(() => new THREE.Vector3(), []);

  // Tells the canvas how much room the keys stand in, so the figure fades out before reaching them.
  const setMargin = (side: Side, px: number, object: HTMLElement | null) => {
    if (!object || margins.current[side] === px) return;
    margins.current[side] = px;
    object.style.setProperty(`--keys-${side}`, `${px}px`);
  };

  useEffect(() => {
    const object = root.current?.closest<HTMLElement>(".object") ?? null;
    return () => {
      object?.style.removeProperty("--keys-left");
      object?.style.removeProperty("--keys-right");
    };
  }, []);

  useFrame(stage, (s, dt) => {
    const host = root.current;
    if (!host || !ids.length) return;
    const rem = rootRem();
    const free = freeArea();
    const left = free.left;
    const right = host.clientWidth - free.right;
    const center = (left + right) / 2;
    const top = free.top + EDGE_REM * rem;
    const bottom = host.clientHeight - free.bottom - EDGE_REM * rem;

    const places = ids.map((id): KeyPlace => {
      const p = s.project(locate(id, s, world));
      const known = sides.current.get(id);
      const sticky = SIDE_STICKINESS_REM * rem;
      const side: Side = known === "left" ? (p.x > center + sticky ? "right" : "left") : known === "right" ? (p.x < center - sticky ? "left" : "right") : p.x < center ? "left" : "right";
      sides.current.set(id, side);
      return { id, anchorX: p.x, anchorY: p.y, behind: p.behind, side, y: 0 };
    });
    const row = rowRem * rem;
    stackColumn(places.filter((p) => p.side === "left"), row, top, bottom);
    stackColumn(places.filter((p) => p.side === "right"), row, top, bottom);

    // Each column is as wide as its longest key, and its leaders all start from one line beside it.
    const handlesOf = new Map(places.map((place) => [place.id, readHandles(host, place.id)]));
    const widest = { left: 0, right: 0 };
    for (const place of places) widest[place.side] = Math.max(widest[place.side], handlesOf.get(place.id)?.key.offsetWidth ?? 0);
    const offset = offsetRem * rem;
    const gap = LEADER_GAP_REM * rem;
    const object = host.closest<HTMLElement>(".object");
    setMargin("left", widest.left ? Math.round(offset + widest.left + gap) : 0, object);
    setMargin("right", widest.right ? Math.round(offset + widest.right + gap) : 0, object);

    const settle = 1 - Math.exp(-dt * SETTLE_PER_SECOND);
    for (const place of places) {
      const handles = handlesOf.get(place.id);
      if (!handles) continue;
      const before = shownY.current.get(place.id);
      const y = before === undefined ? place.y : before + (place.y - before) * settle;
      shownY.current.set(place.id, y);
      const width = handles.key.offsetWidth;
      const x = place.side === "left" ? left + offset + widest.left - width : right - offset - widest.right;
      handles.key.style.visibility = "visible";
      handles.key.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - handles.key.offsetHeight / 2).toFixed(1)}px, 0)`;
      if (handles.key.dataset.side !== place.side) handles.key.dataset.side = place.side;
      // A leader only runs across the space the figure has, never toward a panel or off the page.
      const reachable = !place.behind && place.anchorX > left && place.anchorX < right && place.anchorY > 0 && place.anchorY < bottom;
      const visibility = reachable ? "visible" : "hidden";
      if (handles.leader) {
        handles.leader.style.visibility = visibility;
        if (reachable) {
          handles.leader.setAttribute("x1", (place.side === "left" ? x + width + gap : x - gap).toFixed(1));
          handles.leader.setAttribute("y1", y.toFixed(1));
          handles.leader.setAttribute("x2", place.anchorX.toFixed(1));
          handles.leader.setAttribute("y2", place.anchorY.toFixed(1));
        }
      }
      if (handles.dot) {
        handles.dot.style.visibility = visibility;
        if (reachable) {
          handles.dot.setAttribute("cx", place.anchorX.toFixed(1));
          handles.dot.setAttribute("cy", place.anchorY.toFixed(1));
        }
      }
    }
  });

  return root;
}

function readHandles(host: HTMLElement, id: string): Handles | null {
  const key = host.querySelector<HTMLElement>(`[data-key="${id}"]`);
  if (!key) return null;
  return { key, leader: host.querySelector<SVGLineElement>(`line[data-for="${id}"]`), dot: host.querySelector<SVGCircleElement>(`circle[data-for="${id}"]`) };
}

function Leaders({ ids, active }: { ids: string[]; active?: string | null }) {
  return (
    <svg className="atlas-leaders" aria-hidden="true">
      {ids.map((id) => (
        <g key={id} data-active={active === id || undefined}>
          <line data-for={id} />
          <circle data-for={id} r="2" />
        </g>
      ))}
    </svg>
  );
}

function openTarget(id: string) {
  const muscle = muscleOf(id);
  if (muscle) return () => showMuscle(muscle);
  if (id === "airway") return () => showOrgan("lungs");
  return isOrganId(id) ? () => showOrgan(id) : null;
}

// Level 1: quiet names for what is lit, so no coloured shape is left unexplained.
function LitNames({ stage, lit }: { stage: Stage; lit: { id: AnchorId; name: string }[] }) {
  const hover = useStore((s) => s.hover);
  const hoverMuscle = useStore((s) => s.hoverMuscle);
  const ids = lit.map((l) => l.id);
  const root = useMarginLayout(stage, ids, (id, s, out) => s.anchorOf(id, out), NAME_ROW_REM, NAME_OFFSET_REM);
  return (
    <div ref={root} className="atlas-layer">
      <Leaders ids={ids} />
      {lit.map(({ id, name }) => {
        const open = openTarget(id);
        const muscle = muscleOf(id);
        const hot = id === hover || (muscle !== null && muscle === hoverMuscle);
        return (
          <button
            key={id}
            type="button"
            className="atlas-name"
            data-key={id}
            data-hot={hot || undefined}
            disabled={!open}
            onClick={open ?? undefined}
            onPointerEnter={() => setUi(muscle ? { hoverMuscle: muscle } : { hover: isOrganId(id) ? id : null })}
            onPointerLeave={() => setUi({ hover: null, hoverMuscle: null })}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

// Level 2: the stop numbers, in the same margins, matching the numbers in the panel.
function StopNumbers({ stage, stops }: { stage: Stage; stops: ProcessStop[] }) {
  const spotlight = useStore((s) => s.stop);
  const ids = stops.map((stop) => `stop-${stop.number}`);
  const byId = useRef(new Map<string, ProcessStop>());
  byId.current = new Map(stops.map((stop) => [`stop-${stop.number}`, stop]));
  const root = useMarginLayout(
    stage,
    ids,
    (id, s, out) => {
      const stop = byId.current.get(id);
      return stop ? s.stopAnchor(stop, out) : out;
    },
    NUMBER_ROW_REM,
    NUMBER_OFFSET_REM,
  );
  const here = stops.find((stop) => stop.state === "here");
  return (
    <div ref={root} className="atlas-layer">
      <Leaders ids={ids} active={here ? `stop-${here.number}` : null} />
      {stops.map((stop) => {
        const on = spotlight === stop.number;
        return (
          <button
            key={stop.id}
            type="button"
            className="atlas-number"
            data-key={`stop-${stop.number}`}
            aria-label={`Stop ${stop.number}, ${stop.label}`}
            aria-pressed={on}
            onClick={() => setUi({ stop: stop.number })}
            {...organHover(stop.organ)}
          >
            <span className="stop-face" data-state={stop.state} data-on={on || undefined}>
              {stop.number}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The name of whatever you point at, where nothing else names it.
function HoverName({ stage }: { stage: Stage }) {
  const hover = useStore((s) => s.hover);
  const hoverMuscle = useStore((s) => s.hoverMuscle);
  const focus = useStore((s) => s.body.focus);
  const el = useRef<HTMLDivElement>(null);
  const organ: OrganId | null = isOrganId(hover) ? hover : null;
  const pointed = hoverMuscle ? { id: `muscle:${hoverMuscle}` as const, name: MUSCLE_LABEL[hoverMuscle] } : organ ? { id: organ, name: ORGAN_NAME[organ] } : null;
  // Stays on the last thing through the fade out, so the label never blanks while it leaves.
  const last = useRef(pointed);
  if (pointed) last.current = pointed;
  const world = useMemo(() => new THREE.Vector3(), []);

  useFrame(stage, (s) => {
    const label = el.current;
    const target = last.current;
    if (!label || !target || !label.hasAttribute("data-on")) return;
    const p = s.project(s.anchorOf(target.id, world));
    const parent = label.parentElement;
    label.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    label.dataset.flip = parent && p.x > parent.clientWidth - freeArea().right - NAME_FLIP_REM * rootRem() ? "true" : "false";
  });

  return (
    <div ref={el} className="organ-name" data-on={(pointed !== null && !focus) || undefined} aria-hidden="true">
      <i className="organ-name-dot" />
      {last.current ? <span className="organ-name-text">{last.current.name}</span> : null}
    </div>
  );
}

export function AtlasKeys({ stage }: { stage: Stage }) {
  const processId = useStore((s) => s.body.process);
  const tr = useStore((s) => s.trajectory);
  const focus = useStore((s) => s.body.focus);
  const minute = useMinute();
  const process = useMemo(() => (processId ? selectedProcess(getState()) : null), [processId, tr, minute]);
  const [lit, setLit] = useState<{ id: AnchorId; name: string }[]>([]);
  const frames = useRef(0);

  useFrame(stage, (s) => {
    frames.current = (frames.current + 1) % LIT_CHECK_EVERY_FRAMES;
    if (frames.current) return;
    const next = s.litAnchors().slice(0, MOST_NAMES);
    setLit((current) => (current.map((l) => l.id).join() === next.map((l) => l.id).join() ? current : next));
  });

  useEffect(() => {
    if (processId || focus) setLit([]);
  }, [processId, focus]);

  const showsNumbers = process !== null && !focus;
  const showsNames = lit.length > 0 && !process && !focus;
  return (
    <div className="atlas" data-away={focus !== null || undefined}>
      {showsNumbers ? <StopNumbers key={process.id} stage={stage} stops={process.stops} /> : null}
      {showsNames ? <LitNames stage={stage} lit={lit} /> : <HoverName stage={stage} />}
    </div>
  );
}
