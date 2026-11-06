import { z } from "zod";
import type { Trajectory } from "../model/engine/trajectory";
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

// Less than this doesn't show in any drawing, and every caption rounds it away.
const LEAST_VISIBLE_CHANGE = 0.01;

// While exploring, a drawing is about the question only if the question moved it. One that reads as it does on
// your day is your day's news, such as this morning's coffee during a question about something else.
export function readsLikeYourDay(organ: OrganId, place: Place, yourDay: Trajectory, minute: number) {
  const closeup = closeupOf(organ);
  if (!closeup) return false;
  const here = closeup.fromModel(place, minute);
  const yours = closeup.fromModel({ ...place, trajectory: yourDay }, minute);
  return closeup.keys.every((key) => Math.abs(here[key] - yours[key]) < LEAST_VISIBLE_CHANGE);
}

// A step with an empty light says no level of this drawing means what the step is saying.
export const stepUsesDrawing = (step: CloseupStep | null, organ: OrganId) =>
  step?.organ === organ && (step.light.length > 0 || Object.keys(step.set).length > 0 || step.compare !== null);

// What Claude is told about what it can direct, written from the list.
export const closeupGuidance = () => `Close-ups a step can direct, with what each one's levels mean:
${CLOSEUPS.map(
  (closeup) =>
    `- ${closeup.organ}: ${Object.entries(closeup.settings)
      .map(([key, meaning]) => `${key} (${meaning})`)
      .join("; ")}`,
).join("\n")}`;
