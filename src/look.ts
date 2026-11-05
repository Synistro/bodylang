import type { OrganId } from "./model/simulate";
import type { SystemId } from "./model/systems";

// Colour is rare here, the way syntax colour is in a code block. The overview has one quiet accent.
// Focus on a system or something in it, and its one colour appears on the organs, the line and the
// curves. These are the Flexoki accents, by Steph Ango: the 600 tones on paper, the 400 tones on black.
export type LookTheme = "plate" | "xray";

export const SYSTEM_HUE: Record<SystemId, Record<LookTheme, string>> = {
  overview: { plate: "#100f0f", xray: "#cecdc3" },
  digestion: { plate: "#bc5215", xray: "#da702c" },
  energy: { plate: "#ad8301", xray: "#d0a215" },
  circulation: { plate: "#af3029", xray: "#d14d41" },
  muscles: { plate: "#a02f6f", xray: "#ce5d97" },
  brain: { plate: "#5e409d", xray: "#8b7ec8" },
  immune: { plate: "#24837b", xray: "#3aa99f" },
  clearing: { plate: "#205ea6", xray: "#4385be" },
  reproductive: { plate: "#66800b", xray: "#879a39" },
};

// The system whose colour stands for "working" while nothing in particular is in focus.
export const ACCENT_SYSTEM: SystemId = "digestion";

// The system an organ belongs to when nothing else on screen says otherwise.
export const ORGAN_HOME: Record<OrganId, SystemId> = {
  brain: "brain",
  heart: "circulation",
  lungs: "circulation",
  liver: "clearing",
  stomach: "digestion",
  pancreas: "energy",
  spleen: "immune",
  small_intestine: "digestion",
  large_intestine: "digestion",
  kidneys: "clearing",
  bladder: "clearing",
  muscle: "muscles",
  fat: "energy",
  uterus: "reproductive",
  ovaries: "reproductive",
  prostate: "reproductive",
};

// Whose colour the screen is in. A process keeps its own system's colour, and an organ reached from
// the overview brings its own.
export function viewSystemOf(view: { system: SystemId; process: { system: SystemId } | null; focus: OrganId | null }): SystemId {
  if (view.process) return view.process.system;
  if (view.system !== "overview") return view.system;
  return view.focus ? ORGAN_HOME[view.focus] : "overview";
}
