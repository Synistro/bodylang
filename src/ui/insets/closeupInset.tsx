import type { ComponentType } from "react";
import { Adjustment, Directions, FromModel, Levels, levelsAt, litLevels, Panel, panelsOf } from "../../closeup/define";
import type { OrganId } from "../../model/simulate";
import { closeupOnScreen, useStore } from "../../store";
import { sourced } from "../SourceTip";
import "./closeup.css";
import { easeToward } from "./draw";
import { Frame, InsetProps, Painter, useInsetPainter } from "./loop";
import { Plate, PlateWords } from "./Plate";

const EASE_PER_SECOND = 2.4;

export interface Look<K extends string> {
  levels: Levels<K>;
  lit: Levels<K>;
}

interface Closeup<K extends string> {
  organ: OrganId;
  keys: readonly K[];
  fromModel: FromModel<K>;
  about?: string;
}

interface Drawn<K extends string> {
  Drawing: ComponentType;
  paint: (art: SVGSVGElement) => (frame: Frame, look: Look<K>) => void; // only ever sees the numbers to show now
  usePlate: (props: InsetProps, levels: Levels<K>) => PlateWords;
}

const sourcesOf = (about: string | undefined, basis: string | null | undefined) => {
  if (basis) return sourced({ kind: "claude-input", detail: `${about ? `${about} ` : ""}Some levels here are Claude's illustration. Its basis: ${basis}` });
  return about ? sourced({ kind: "model", detail: about }) : {};
};

// Turns an organ's definition and drawing into its panel: the model sets the levels, a walkthrough step can
// point at parts of them and adjust them, and two drawings stack when a step compares.
export function closeupInset<K extends string>(closeup: Closeup<K>, { Drawing, paint, usePlate }: Drawn<K>): ComponentType<InsetProps> {
  const { keys, fromModel } = closeup;

  // The levels are read fresh each frame and eased, so moving between steps or along the chart reads as the
  // same tissue changing.
  const painter = (art: SVGSVGElement): Painter<InsetProps & { adjustment: Adjustment<K> }> => {
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

  function OnePanel({ label, adjustment, ...props }: InsetProps & Panel<K>) {
    const art = useInsetPainter(painter, { ...props, adjustment });
    const words = usePlate(props, levelsAt(keys, fromModel, props, props.t, adjustment));
    return (
      <Plate {...words} caption={label ?? words.caption} artRef={art}>
        <Drawing />
      </Plate>
    );
  }

  return function CloseupInset(props: InsetProps) {
    const step = useStore(closeupOnScreen);
    // The step's organ was checked against this one, so its levels are this close-up's levels.
    const directed = step?.organ === closeup.organ ? (step as unknown as Directions<K>) : null;
    return (
      <div {...sourcesOf(closeup.about, directed?.basis)}>
        {panelsOf(directed).map((panel) => (
          <OnePanel key={panel.label ?? "only"} {...props} {...panel} />
        ))}
      </div>
    );
  };
}
