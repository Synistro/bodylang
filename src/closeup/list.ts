import { z } from "zod";
import type { OrganId } from "../model/simulate";
import { brainCloseup } from "./brain";
import type { Levels, Place, Travel } from "./define";
import { heartCloseup } from "./heart";
import { muscleCloseup } from "./muscle";
import { pancreasCloseup } from "./pancreas";
import { smallIntestineCloseup } from "./smallIntestine";
import { stomachCloseup } from "./stomach";

// The organs whose close-up a step can direct. A new one is one more entry in each of these two lists, and
// the tool schema and Claude's instructions follow from them.
const CLOSEUPS = [muscleCloseup, brainCloseup, stomachCloseup, smallIntestineCloseup, pancreasCloseup, heartCloseup] as const;
export const closeupSpec = z.discriminatedUnion("organ", [muscleCloseup.spec, brainCloseup.spec, stomachCloseup.spec, smallIntestineCloseup.spec, pancreasCloseup.spec, heartCloseup.spec]);
export type CloseupStep = z.infer<typeof closeupSpec>;

export interface AnyCloseup {
  organ: OrganId;
  keys: readonly string[];
  fromModel: (place: Place, minute: number) => Levels;
  travels: Partial<Record<string, Travel>>;
}

export const closeupOf = (organ: OrganId): AnyCloseup | null => CLOSEUPS.find((closeup) => closeup.organ === organ) ?? null;

// What Claude is told about what it can direct, written from the list.
export const closeupGuidance = () => `Close-ups a step can direct, with what each one's levels mean:
${CLOSEUPS.map((closeup) => `- ${closeup.organ}: ${Object.entries(closeup.settings).map(([key, meaning]) => `${key} (${meaning})`).join("; ")}`).join("\n")}`;
