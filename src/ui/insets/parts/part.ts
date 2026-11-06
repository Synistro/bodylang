import type { ComponentType } from "react";
import { lerp } from "../draw";
import { clamp01 } from "../../../model/curve";
import type { Frame } from "../loop";

// One piece of anatomy, drawn the same way in every close-up, so a vessel reads as a vessel wherever it
// appears. A drawing places parts and tells them how much is happening. A part knows how it looks and moves.
export interface Part<Input> {
  Art: ComponentType;
  attach: (art: SVGSVGElement) => (frame: Frame, input: Input) => void;
}

const QUIET = 0.4;

const setOpacity = (element: SVGElement, opacity: number) => {
  element.style.opacity = String(Math.round(opacity * 100) / 100);
};

// What the current step is about stands out, and the rest of the tissue stays visible behind it.
const brightness = (lit: number) => lerp(QUIET, 1, clamp01(lit));

export const setLit = (element: SVGElement, lit: number) => setOpacity(element, brightness(lit));

// Something that appears when there is some of it, and dims when the step is about something else.
export const setShown = (element: SVGElement, shown: number, lit = 1) => setOpacity(element, clamp01(shown) * brightness(lit));

// A word goes completely, so a step only ever names what it is showing.
export const setWord = (element: SVGElement, shown: number, lit = 1) => setOpacity(element, clamp01(shown) * clamp01(lit));
