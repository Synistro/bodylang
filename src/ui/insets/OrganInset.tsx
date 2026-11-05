import type { ComponentType } from "react";
import type { OrganId } from "../../model/simulate";
import { BladderInset } from "./BladderInset";
import { BrainInset } from "./BrainInset";
import { FatInset } from "./FatInset";
import { HeartInset } from "./HeartInset";
import { ImmuneInset } from "./ImmuneInset";
import { KidneysInset } from "./KidneysInset";
import { LargeIntestineInset } from "./LargeIntestineInset";
import { LiverInset } from "./LiverInset";
import type { InsetProps } from "./loop";
import { LungsInset } from "./LungsInset";
import { MuscleInset } from "./MuscleInset";
import { OvariesInset } from "./OvariesInset";
import { PancreasInset } from "./PancreasInset";
import { ProstateInset } from "./ProstateInset";
import { SmallIntestineInset } from "./SmallIntestineInset";
import { StomachInset } from "./StomachInset";
import { UterusInset } from "./UterusInset";

// A new figure is one new entry here.
export const FIGURES: Record<OrganId, ComponentType<InsetProps>> = {
  stomach: StomachInset,
  liver: LiverInset,
  brain: BrainInset,
  heart: HeartInset,
  pancreas: PancreasInset,
  muscle: MuscleInset,
  lungs: LungsInset,
  spleen: ImmuneInset,
  kidneys: KidneysInset,
  bladder: BladderInset,
  small_intestine: SmallIntestineInset,
  large_intestine: LargeIntestineInset,
  fat: FatInset,
  uterus: UterusInset,
  ovaries: OvariesInset,
  prostate: ProstateInset,
};

export function OrganInset({ organ, trajectory, t, muscle }: InsetProps & { organ: OrganId }) {
  const Figure = FIGURES[organ];
  return <Figure trajectory={trajectory} t={t} muscle={muscle} />;
}
