import { Component, type ComponentType, type ReactNode } from "react";
import type { OrganId } from "../../model/ids";
import { composedOnScreen, useStore } from "../../store";
import { BladderInset } from "./BladderInset";
import { ComposedInset } from "./ComposedInset";
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
const FIGURES: Record<OrganId, ComponentType<InsetProps>> = {
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

// A drawing that fails says so in its own panel, and the rest of the app keeps working.
class DrawingBoundary extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }

  render() {
    return this.state.failed ? <p className="hint">This drawing failed. {this.state.failed}</p> : this.props.children;
  }
}

export function OrganInset({ organ, trajectory, t, muscle }: InsetProps & { organ: OrganId }) {
  const composed = useStore(composedOnScreen);
  const Figure = FIGURES[organ];
  return <DrawingBoundary key={organ}>{composed ? <ComposedInset spec={composed} /> : <Figure trajectory={trajectory} t={t} muscle={muscle} />}</DrawingBoundary>;
}
