import { CheckedWords } from "./Conversation";
import { useEffect, useState } from "react";
import { closeGuide, getState, goToStep, leaveAsk, setUi, useStore } from "../store";
import { X } from "./icons";

const AUTO_ADVANCE_MS = 7000;
const GLIDE_MS = 700;

// Says you are exploring and how to get back, for as long as you are.
export function AskBar() {
  const asking = useStore((s) => s.asking !== null);
  const last = useStore((s) => {
    const newest = s.exchanges[s.exchanges.length - 1];
    return newest && newest.session === s.asking?.id ? newest : null;
  });
  if (!asking) return null;
  const shown = last?.name ?? last?.text ?? "";
  return (
    <div className="ask-bar">
      <span key={shown} className="ask-question" title={last?.text}>
        {shown}
      </span>
      <span className="ask-note">Not saved</span>
      <button type="button" className="link" onClick={leaveAsk}>
        Back to your day
      </button>
    </div>
  );
}

// The body moves through time instead of jumping, so you see what changes on the way.
function glideTo(at: number) {
  const from = getState().t;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(at - from) < 1) {
    setUi({ t: at });
    return () => undefined;
  }
  const start = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / GLIDE_MS);
    const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    setUi({ t: from + (at - from) * eased });
    if (k < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

// Claude's explanation, one step at a time, spoken from just above the day while the body shows it.
export function Guide() {
  const guide = useStore((s) => (s.asking?.guideOpen && !s.touring ? s.asking.guide : null));
  const index = useStore((s) => s.asking?.step ?? 0);
  const [auto, setAuto] = useState(false);
  const step = guide?.[index];
  const isLast = guide !== null && index === guide.length - 1;

  useEffect(() => {
    if (step?.at === null || step?.at === undefined) return;
    return glideTo(step.at);
  }, [step]);

  useEffect(() => {
    if (!guide) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") goToStep(Math.min(guide.length - 1, index + 1));
      else if (e.key === "ArrowLeft") goToStep(Math.max(0, index - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key, { capture: true });
    return () => window.removeEventListener("keydown", key, { capture: true });
  }, [guide, index]);

  useEffect(() => {
    if (!auto || !guide || isLast) return;
    const id = window.setTimeout(() => goToStep(index + 1), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [auto, guide, index, isLast]);

  if (!guide || !step) return null;

  return (
    <aside className="tour" aria-label="Claude's explanation">
      <div className="tour-head">
        <span className="tour-label">{step.title}</span>
        <span className="tour-count">
          {index + 1} of {guide.length}
        </span>
        <button type="button" className="icon-button" aria-label="Close the explanation" onClick={closeGuide}>
          <X />
        </button>
      </div>
      <p key={index} className="tour-say" aria-live="polite">
        <CheckedWords text={step.say} unverified={step.unverified ?? []} />
      </p>
      <div className="tour-actions">
        <button type="button" className="action" disabled={index === 0} onClick={() => goToStep(index - 1)}>
          Back
        </button>
        <button type="button" className="action" onClick={() => (isLast ? closeGuide() : goToStep(index + 1))}>
          {isLast ? "Done" : "Next"}
        </button>
        <button type="button" className="toggle" aria-pressed={auto} onClick={() => setAuto(!auto)}>
          Auto
        </button>
      </div>
      {auto && !isLast ? <i key={index} className="tour-progress" style={{ animationDuration: `${AUTO_ADVANCE_MS}ms` }} aria-hidden="true" /> : null}
    </aside>
  );
}
