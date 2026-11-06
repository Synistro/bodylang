import { ReactNode, useEffect, useMemo, useRef } from "react";
import { MUSCLE_LABEL } from "../model/muscleGroups";
import type { OrganId } from "../model/simulate";
import { ORGAN_NAME, SYSTEMS, SystemId } from "../model/systems";
import { Origin, processOrigin, SENTENCE_ORIGIN } from "../model/origin";
import { threadsAt } from "../model/threads";
import { processIdsOf } from "../model/yourDay";
import { currentProcesses, getState, useStore, yourDayWhileAsking } from "../store";
import { assessmentAt, organHover, useMinute, isTyping } from "./hooks";
import { SYSTEM_GLYPH } from "./icons";
import { showProcess, showSystem } from "./navigation";
import { sourced } from "./SourceTip";

interface Leaf {
  id: string;
  title: string;
  note: string;
  active: boolean;
  organ: OrganId | null;
  origin: Origin;
}

// What sits under the system you are in: the things you logged, or the processes running through it.
function useLeaves(system: SystemId): Leaf[] {
  const tr = useStore((s) => s.trajectory);
  const yourDay = useStore(yourDayWhileAsking);
  const minute = useMinute();
  return useMemo(() => {
    const processes = currentProcesses(getState());
    const threads = threadsAt(tr, minute);
    const alreadyYours = yourDay ? processIdsOf(yourDay, minute) : null;
    const isNews = (id: string) => !alreadyYours?.has(id);
    const hereOf = (id: string) => processes.find((p) => p.id === id)?.stops.find((stop) => stop.state === "here")?.organ ?? null;
    const originOf = (id: string) => {
      const process = processes.find((p) => p.id === id);
      return process ? processOrigin(tr, process) : SENTENCE_ORIGIN;
    };
    if (system === "overview") {
      return threads
        .filter((t) => t.at <= minute && isNews(t.processId))
        .map((t) => ({ id: t.processId, title: t.title, note: t.status, active: t.active, organ: hereOf(t.processId), origin: originOf(t.processId) }));
    }
    return processes
      .filter((p) => (p.system === system || (p.alsoIn?.includes(system) ?? false)) && isNews(p.id))
      .sort((a, b) => Number(b.active) - Number(a.active))
      .map((p) => {
        const thread = threads.find((t) => t.processId === p.id);
        return { id: p.id, title: p.title, note: thread?.status ?? "", active: p.active, organ: hereOf(p.id), origin: originOf(p.id) };
      });
  }, [tr, yourDay, minute, system]);
}

// Keeps what it showed while it folds away, so closing is as gentle as opening.
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  if (open) last.current = children;
  return (
    <div className="tree-fold" data-open={open || undefined} inert={!open}>
      <div className="tree-fold-inner">{open ? children : last.current}</div>
    </div>
  );
}

// The one row that is exactly where you are, nested under whatever you came through.
function FocusLeaf() {
  const focus = useStore((s) => s.body.focus);
  const focusMuscle = useStore((s) => s.body.focusMuscle);
  // Clicking the brain only moves the camera: it is the page you are already on.
  if (!focus || focus === "brain") return null;
  return (
    <ul className="tree-leaves">
      <li>
        <span className="tree-leaf" aria-current="location">
          <span className="tree-leaf-title">{focusMuscle ? MUSCLE_LABEL[focusMuscle] : ORGAN_NAME[focus]}</span>
        </span>
      </li>
    </ul>
  );
}

function Leaves({ system }: { system: SystemId }) {
  const leaves = useLeaves(system);
  const processId = useStore((s) => s.body.process);
  const focused = useStore((s) => s.body.focus !== null);
  const selected = useStore((s) => (s.body.process ? currentProcesses(s).find((p) => p.id === s.body.process) ?? null : null));
  // Something selected from elsewhere, such as by Claude, still needs its place in the outline.
  const shown = selected && !leaves.some((leaf) => leaf.id === selected.id) ? [...leaves, { id: selected.id, title: selected.title, note: "", active: true, organ: null, origin: SENTENCE_ORIGIN }] : leaves;
  return (
    <>
      <ul className="tree-leaves">
        {shown.map((leaf) => {
          const here = leaf.id === processId;
          return (
            <li key={leaf.id}>
              <button type="button" className="tree-leaf" data-idle={!leaf.active || undefined} data-open={here || undefined} aria-current={here && !focused ? "location" : undefined} onClick={() => showProcess(leaf.id)} {...organHover(leaf.organ)}>
                <span className="tree-leaf-title">{leaf.title}</span>
                {leaf.note ? (
                  <span className="tree-note" {...sourced(leaf.origin)}>
                    {leaf.note}
                  </span>
                ) : null}
              </button>
              {here ? <FocusLeaf /> : null}
            </li>
          );
        })}
      </ul>
      {processId ? null : <FocusLeaf />}
    </>
  );
}

// The outline of the body: the systems, with the one you are in opened to where you are. Reading it
// tells you the level you are on, and any row in it takes you there.
export function Rail() {
  const system = useStore((s) => s.body.system);
  const atSystem = useStore((s) => !s.body.process && !s.body.focus);
  const tr = useStore((s) => s.trajectory);
  const minute = useMinute();
  const statuses = assessmentAt(tr, minute).systems;
  const yourDay = useStore(yourDayWhileAsking);
  const yours = yourDay ? assessmentAt(yourDay, minute).systems : null;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !/^[1-9]$/.test(e.key)) return;
      const picked = SYSTEMS[Number(e.key) - 1];
      if (picked) showSystem(picked.id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <nav className="rail" aria-label="Body systems">
      {SYSTEMS.map((s) => {
        const status = statuses[s.id];
        const open = s.id === system;
        // Only what matters most right now gets a word. Bright means something is going on there.
        const unchanged = yours?.[s.id].word === status.word;
        const quiet = (status.quiet || unchanged) && s.id !== "overview";
        const speaks = status.emphasis && s.id !== "overview" && !unchanged;
        const Icon = SYSTEM_GLYPH[s.id];
        return (
          <div key={s.id} className="tree-node">
            <button type="button" className="tree-row" data-quiet={quiet || undefined} data-open={open || undefined} aria-current={open && atSystem ? "location" : undefined} onClick={() => showSystem(s.id)}>
              <Icon className="tree-icon" weight="light" />
              <span className="tree-title">{s.title}</span>
              {speaks ? (
                <span className="tree-note" data-tone={status.tone}>
                  {status.word}
                </span>
              ) : null}
            </button>
            <Fold open={open}>
              <Leaves system={s.id} />
            </Fold>
          </div>
        );
      })}
    </nav>
  );
}
