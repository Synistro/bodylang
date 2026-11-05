import { useEffect, useLayoutEffect, useRef } from "react";
import type { MuscleGroup } from "../../model/muscleGroups";
import type { Trajectory } from "../../model/simulate";

export interface InsetProps {
  trajectory: Trajectory;
  t: number;
  muscle: MuscleGroup | null; // the group in focus, for figures of one muscle
}

export interface Frame {
  dt: number; // seconds since the last frame
  clock: number; // seconds this figure has been animating
  still: boolean; // reduced motion: draw the resting picture for this moment of the model
}

export type Painter<P = InsetProps> = (frame: Frame, props: P) => void;

// One requestAnimationFrame loop per figure. React renders the figure's parts once and the painter
// moves them, so playing the timeline never re-renders React on every frame.
export function useInsetPainter<P = InsetProps>(create: (art: SVGSVGElement) => Painter<P>, props: P) {
  const art = useRef<SVGSVGElement>(null);
  const latest = useRef(props);
  const drawStill = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    latest.current = props;
    drawStill.current?.();
  });

  useEffect(() => {
    const paint = create(art.current!);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = 0;
    let clock = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      paint({ dt, clock, still: false }, latest.current);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (motion.matches) {
        drawStill.current = () => paint({ dt: 0, clock: 0, still: true }, latest.current);
        drawStill.current();
        return;
      }
      drawStill.current = null;
      paint({ dt: 0, clock, still: false }, latest.current);
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    start();
    motion.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(raf);
      motion.removeEventListener("change", start);
      drawStill.current = null;
    };
  }, [create]);

  return art;
}
