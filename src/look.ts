import type { OrganId, SystemId } from "./model/ids";
import { ORGAN_HOME } from "./model/systems";

// Colour is rare here, the way syntax colour is in a code block. The overview has one quiet accent.
// Focus on a system or something in it, and its one colour appears on the organs, the line and the
// curves. These are the Flexoki accents, by Steph Ango: the 600 tones on paper, the 400 tones on black,
// except our own softer orange and ink on black. On paper the main accent is blue, so Liver & kidneys,
// blue on black, takes the orange there.
export type Theme = "light" | "dark";

export const SYSTEM_HUE: Record<SystemId, Record<Theme, string>> = {
  overview: { light: "#17181a", dark: "#d0cec6" },
  digestion: { light: "#2a78d6", dark: "#d97540" },
  energy: { light: "#ad8301", dark: "#d0a215" },
  circulation: { light: "#af3029", dark: "#d14d41" },
  muscles: { light: "#a02f6f", dark: "#ce5d97" },
  brain: { light: "#5e409d", dark: "#8b7ec8" },
  immune: { light: "#24837b", dark: "#3aa99f" },
  clearing: { light: "#bc5215", dark: "#4385be" },
  reproductive: { light: "#66800b", dark: "#879a39" },
};

// An organ is a large shape and a strong colour would shout, so organs take the softer black tone on
// either ground. The two systems that swap colours on paper have no black tone to borrow there.
const ORGAN_ON_PAPER: Partial<Record<SystemId, string>> = {
  digestion: SYSTEM_HUE.digestion.light,
  clearing: SYSTEM_HUE.clearing.light,
};

export function organHue(system: SystemId, theme: Theme): string {
  return (theme === "light" ? ORGAN_ON_PAPER[system] : undefined) ?? SYSTEM_HUE[system].dark;
}

// The system whose colour stands for "working" while nothing in particular is in focus.
export const ACCENT_SYSTEM: SystemId = "digestion";

// Whose colour the screen is in. A process keeps its own system's colour, and an organ reached from
// the overview brings its own.
export function viewSystemOf(view: {
  system: SystemId;
  process: { system: SystemId } | null;
  focus: OrganId | null;
}): SystemId {
  if (view.process) return view.process.system;
  if (view.system !== "overview") return view.system;
  return view.focus ? ORGAN_HOME[view.focus] : "overview";
}
