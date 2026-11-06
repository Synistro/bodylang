import { useEffect, useState } from "react";
import { isTyping } from "./hooks";
import { processOrigin } from "../model/origin";
import { selectedProcess, setUi, useStore } from "../store";
import { X } from "./icons";
import { sourced } from "./SourceTip";

const AUTO_ADVANCE_MS = 6000;

const endTour = () => setUi({ touring: false, stop: null });

// The walkthrough speaks from just above the message box, where the eye already is while the camera flies. The
// controls start from the process in the panel; Esc is handled with the other moves up a level.
export function Tour() {
  const processId = useStore((s) => s.body.process);
  const touring = useStore((s) => s.touring);
  const spotlight = useStore((s) => s.stop);
  const focused = useStore((s) => s.body.focus !== null);
  const process = useStore((s) => (s.touring ? selectedProcess(s) : null));
  const tr = useStore((s) => s.trajectory);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    setUi({ stop: null, touring: false });
  }, [processId]);

  const stops = process?.stops ?? [];
  const index = stops.findIndex((s) => s.number === spotlight);
  const current = stops[index];
  const isLast = index === stops.length - 1;

  const goTo = (i: number) => {
    const next = stops[Math.max(0, Math.min(stops.length - 1, i))];
    if (next) setUi({ stop: next.number });
  };

  useEffect(() => {
    if (touring && (!current || focused)) endTour();
  }, [touring, current, focused]);

  useEffect(() => {
    if (!touring) return;
    const key = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === "ArrowRight") goTo(index + 1);
      else if (e.key === "ArrowLeft") goTo(index - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  useEffect(() => {
    if (!touring || !auto || isLast) return;
    const id = window.setTimeout(() => goTo(index + 1), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [touring, auto, isLast, index, spotlight]);

  if (!touring || !process || !current) return null;
  const from = sourced(processOrigin(tr, process));

  return (
    <aside className="tour" aria-label={`Walking through ${process.title}`}>
      <div className="tour-head">
        <span className="stop-face" data-state={current.state}>
          {current.number}
        </span>
        <span className="tour-label">{current.label}</span>
        <span className="tour-reading" {...from}>
          {current.reading}
        </span>
        <span className="tour-count">
          {index + 1} of {stops.length}
        </span>
        <button type="button" className="icon-button" aria-label="End the walkthrough" onClick={endTour}>
          <X />
        </button>
      </div>
      <p key={current.id} className="tour-say" aria-live="polite" {...from}>
        {current.say}
      </p>
      <div className="tour-actions">
        <button type="button" className="action" disabled={index === 0} onClick={() => goTo(index - 1)}>
          Back
        </button>
        <button type="button" className="action" onClick={() => (isLast ? endTour() : goTo(index + 1))}>
          {isLast ? "Done" : "Next"}
        </button>
        <button type="button" className="toggle" aria-pressed={auto} onClick={() => setAuto(!auto)}>
          Auto
        </button>
      </div>
      {auto && !isLast ? <i key={current.number} className="tour-progress" style={{ animationDuration: `${AUTO_ADVANCE_MS}ms` }} aria-hidden="true" /> : null}
    </aside>
  );
}
