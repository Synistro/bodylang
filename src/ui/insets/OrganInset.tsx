import type { ComponentType } from "react";
import type { OrganId } from "../../model/simulate";
import { BrainInset } from "./BrainInset";
import { HeartInset } from "./HeartInset";
import { ImmuneInset } from "./ImmuneInset";
import { LiverInset } from "./LiverInset";
import type { InsetProps } from "./loop";
import { LungsInset } from "./LungsInset";
import { MuscleInset } from "./MuscleInset";
import { PancreasInset } from "./PancreasInset";
import { StomachInset } from "./StomachInset";

// A new figure is one new entry here.
const FIGURES: Partial<Record<OrganId, ComponentType<InsetProps>>> = {
  stomach: StomachInset,
  liver: LiverInset,
  brain: BrainInset,
  heart: HeartInset,
  pancreas: PancreasInset,
  muscle: MuscleInset,
  lungs: LungsInset,
  spleen: ImmuneInset,
};

export function OrganInset({ organ, trajectory, t, muscle }: InsetProps & { organ: OrganId }) {
  const Figure = FIGURES[organ];
  return Figure ? <Figure trajectory={trajectory} t={t} muscle={muscle} /> : null;
}
