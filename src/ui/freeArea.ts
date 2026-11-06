import { RefObject, useEffect } from "react";
import type { Insets } from "../scene/camera";

const STACKED_BELOW_PX = 820;
const BREATHING_REM = 0.4;
const NO_PANELS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

let current: Insets = NO_PANELS;

// How much of the canvas the panels take, in CSS px. The scene frames the body in what is left, and
// the atlas keys stand at its edges.
export const freeArea = () => current;

function measure(sheet: HTMLElement): Insets {
  // Stacked, only the clock stands over the canvas.
  if (window.innerWidth <= STACKED_BELOW_PX)
    return { ...NO_PANELS, top: sheet.querySelector(".header-slot")?.getBoundingClientRect().bottom ?? 0 };
  const left = sheet.querySelector(".left")?.getBoundingClientRect();
  const right = sheet.querySelector(".right")?.getBoundingClientRect();
  const consoleBox = sheet.querySelector(".console")?.getBoundingClientRect();
  if (!left || !right || !consoleBox) return NO_PANELS;
  const breathing = BREATHING_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
  // The columns are the same width, so the body stands in the middle of the whole window.
  const side = Math.max(left.right, window.innerWidth - right.left) + breathing;
  const askBar = sheet.querySelector(".ask-bar")?.getBoundingClientRect();
  return {
    left: side,
    right: side,
    top: askBar ? askBar.bottom : parseFloat(getComputedStyle(sheet).paddingTop),
    bottom: window.innerHeight - consoleBox.top,
  };
}

export function useFreeArea(sheet: RefObject<HTMLElement | null>, asking: boolean) {
  useEffect(() => {
    const el = sheet.current;
    const consoleBox = el?.querySelector(".console");
    if (!el || !consoleBox) return;
    const update = () => {
      const next = measure(el);
      if (
        next.left === current.left &&
        next.right === current.right &&
        next.top === current.top &&
        next.bottom === current.bottom
      )
        return;
      current = next;
      // The same numbers fade the figure out before it reaches a panel.
      const style = document.documentElement.style;
      style.setProperty("--free-left", `${next.left}px`);
      style.setProperty("--free-right", `${next.right}px`);
      style.setProperty("--free-bottom", `${next.bottom}px`);
      style.setProperty("--free-top", `${next.top}px`);
    };
    update();
    const resized = new ResizeObserver(update);
    resized.observe(el);
    resized.observe(consoleBox);
    return () => resized.disconnect();
  }, [sheet, asking]);
}
