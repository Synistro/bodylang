import { z } from "zod";
import type { OrganId } from "../model/ids";
import { bladderCloseup } from "./bladder";
import { brainCloseup } from "./brain";
import type { Levels, Place, Travel } from "./define";
import { fatCloseup } from "./fat";
import { heartCloseup } from "./heart";
import { kidneysCloseup } from "./kidneys";
import { largeIntestineCloseup } from "./largeIntestine";
import { liverCloseup } from "./liver";
import { lungsCloseup } from "./lungs";
import { muscleCloseup } from "./muscle";
import { ovariesCloseup } from "./ovaries";
import { pancreasCloseup } from "./pancreas";
import { prostateCloseup } from "./prostate";
import { smallIntestineCloseup } from "./smallIntestine";
import { spleenCloseup } from "./spleen";
import { stomachCloseup } from "./stomach";
import { uterusCloseup } from "./uterus";

// The organs whose close-up a step can direct. A new one is one more entry in each of these two lists, and
// the tool schema and Claude's instructions follow from them.
const CLOSEUPS = [
  muscleCloseup,
  brainCloseup,
  stomachCloseup,
  smallIntestineCloseup,
  pancreasCloseup,
  heartCloseup,
  liverCloseup,
  lungsCloseup,
  kidneysCloseup,
  bladderCloseup,
  largeIntestineCloseup,
  fatCloseup,
  spleenCloseup,
  uterusCloseup,
  ovariesCloseup,
  prostateCloseup,
] as const;
export const closeupSpec = z.discriminatedUnion("organ", [
  muscleCloseup.spec,
  brainCloseup.spec,
  stomachCloseup.spec,
  smallIntestineCloseup.spec,
  pancreasCloseup.spec,
  heartCloseup.spec,
  liverCloseup.spec,
  lungsCloseup.spec,
  kidneysCloseup.spec,
  bladderCloseup.spec,
  largeIntestineCloseup.spec,
  fatCloseup.spec,
  spleenCloseup.spec,
  uterusCloseup.spec,
  ovariesCloseup.spec,
  prostateCloseup.spec,
]);
export type CloseupStep = z.infer<typeof closeupSpec>;

export interface AnyCloseup {
  organ: OrganId;
  keys: readonly string[];
  fromModel: (place: Place, minute: number) => Levels;
  travels: Partial<Record<string, Travel>>;
}

export const closeupOf = (organ: OrganId): AnyCloseup | null =>
  CLOSEUPS.find((closeup) => closeup.organ === organ) ?? null;

// What Claude is told about what it can direct, written from the list.
export const closeupGuidance = () => `Close-ups a step can direct, with what each one's levels mean:
${CLOSEUPS.map(
  (closeup) =>
    `- ${closeup.organ}: ${Object.entries(closeup.settings)
      .map(([key, meaning]) => `${key} (${meaning})`)
      .join("; ")}`,
).join("\n")}`;
