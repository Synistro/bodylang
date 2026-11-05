import { Adjustment, FromModel, levelsAt, Levels, litLevels } from "../../closeup/define";
import { easeToward } from "./draw";
import type { Frame, InsetProps, Painter } from "./loop";

const EASE_PER_SECOND = 2.4;

export interface CloseupProps<K extends string> extends InsetProps {
  adjustment: Adjustment<K>;
}

export interface Look<K extends string> {
  levels: Levels<K>;
  lit: Levels<K>;
}

// Reads the levels each frame and eases them, so moving between steps or along the chart reads as the same
// tissue changing. A drawing only ever sees the numbers it should show now.
export function closeupPainter<K extends string>({ keys, fromModel }: { keys: readonly K[]; fromModel: FromModel<K> }, paint: (art: SVGSVGElement) => (frame: Frame, look: Look<K>) => void) {
  return (art: SVGSVGElement): Painter<CloseupProps<K>> => {
    const draw = paint(art);
    const levels = {} as Record<K, number>;
    const lit = {} as Record<K, number>;
    const ease = (eased: Record<K, number>, target: Levels<K>, frame: Frame) => {
      for (const key of keys) eased[key] = frame.still || eased[key] === undefined ? target[key] : easeToward(eased[key], target[key], frame.dt, EASE_PER_SECOND);
    };
    return (frame, { trajectory, t, muscle, adjustment }) => {
      ease(levels, levelsAt(keys, fromModel, { trajectory, muscle }, t, adjustment), frame);
      ease(lit, litLevels(keys, adjustment.light), frame);
      draw(frame, { levels, lit });
    };
  };
}
