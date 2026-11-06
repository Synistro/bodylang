import { RefObject, useDeferredValue, useEffect, useRef } from "react";
import { assess } from "../model/assess/assess";
import { Assessment, Reading } from "../model/assess/types";
import { Trajectory } from "../model/engine/trajectory";
import { OrganId } from "../model/ids";
import type { Stage } from "../scene/stage";
import { AppState, muscleMinute, setUi, useStore, yourDayWhileAsking } from "../store";

const PLAY_STEP_MINUTES = 5;
const SCROLL_FADE_PX = 28;

// The minute that readings and sentences draw from. Coarser while the day plays, so the figures
// stay readable and React is never busy at frame rate. Deferred, so a scrub stays ahead of it.
const readableMinute = (s: AppState, t: number) =>
  s.playing ? Math.round(t / PLAY_STEP_MINUTES) * PLAY_STEP_MINUTES : Math.round(t);

export function useMinute(): number {
  return useDeferredValue(useStore((s) => readableMinute(s, s.t)));
}

// The same, for what a muscle shows, which a walkthrough step can take off the chart.
export function useMuscleMinute(): number {
  return useDeferredValue(useStore((s) => readableMinute(s, muscleMinute(s))));
}

const assessed = new WeakMap<Trajectory, { minute: number; result: Assessment }>();

// The rail, the panel and the timeline all read the same assessment in the same render.
export function assessmentAt(tr: Trajectory, minute: number): Assessment {
  const known = assessed.get(tr);
  if (known?.minute === minute) return known.result;
  const result = assess(tr, minute);
  assessed.set(tr, { minute, result });
  return result;
}

// Whether a reading says anything about the question: while exploring, one that reads the same on your day doesn't.
export function useIsNews(minute: number) {
  const yourDay = useStore(yourDayWhileAsking);
  return (reading: Reading) =>
    !yourDay ||
    assessmentAt(yourDay, minute).readings.find((yours) => yours.id === reading.id)?.display !== reading.display;
}

export function useFrame(stage: Stage | null, listener: (stage: Stage, dt: number) => void) {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    if (!stage) return;
    const run = (s: Stage, dt: number) => latest.current(s, dt);
    stage.frameListeners.add(run);
    return () => {
      stage.frameListeners.delete(run);
    };
  }, [stage]);
}

export const rootRem = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

export const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && target.type !== "range") ||
  (target instanceof HTMLElement && target.isContentEditable);

export function organHover(organ: OrganId | null) {
  return {
    onPointerEnter: () => setUi({ hover: organ }),
    onPointerLeave: () => setUi({ hover: null }),
    onFocus: () => setUi({ hover: organ }),
    onBlur: () => setUi({ hover: null }),
  };
}

// Fades the edge of a scroller only on the sides that have more to show.
export function useScrollFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const below = el.scrollHeight - el.clientHeight - el.scrollTop;
      el.style.setProperty("--fade-top", `${Math.min(el.scrollTop, SCROLL_FADE_PX)}px`);
      el.style.setProperty("--fade-bottom", `${Math.max(0, Math.min(below, SCROLL_FADE_PX))}px`);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resized = new ResizeObserver(update);
    resized.observe(el);
    const changed = new MutationObserver(update);
    changed.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      resized.disconnect();
      changed.disconnect();
    };
  }, [ref]);
}
